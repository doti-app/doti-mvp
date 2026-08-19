export const PROFILE_AVATAR_BUCKET = 'doti-avatars';

const PRESET_AVATAR_PATTERN = /^\/assets\/avatars-users\/avatar-(0[1-9]|[12][0-9]|30)\.png$/;
const LOCAL_PHOTO_PATTERN = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i;
const STORED_AVATAR_PATTERN = /^profile-avatar:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(\d{1,16})$/i;

export function isPresetAvatar(value) {
  return PRESET_AVATAR_PATTERN.test(String(value || ''));
}

export function isLocalPhoto(value) {
  const avatar = String(value || '');
  return LOCAL_PHOTO_PATTERN.test(avatar) && avatar.length <= 900000;
}

export function storedAvatarParts(value) {
  const match = String(value || '').match(STORED_AVATAR_PATTERN);
  return match ? { userId: match[1].toLowerCase(), version: match[2] } : null;
}

export function validAvatar(value, { allowLocalPhoto = true } = {}) {
  const avatar = String(value || '');
  if (isPresetAvatar(avatar) || storedAvatarParts(avatar)) return avatar;
  if (allowLocalPhoto && isLocalPhoto(avatar)) return avatar;
  return '';
}

export function createStoredAvatarReference(userId, version = Date.now()) {
  const reference = `profile-avatar:${String(userId || '').toLowerCase()}:${version}`;
  if (!storedAvatarParts(reference)) throw new Error('Não foi possível identificar a conta para salvar a foto.');
  return reference;
}

export function storedAvatarPath(value) {
  const parts = storedAvatarParts(value);
  return parts ? `${parts.userId}/avatar.jpg` : '';
}

export function avatarImageUrl(value) {
  const avatar = validAvatar(value);
  return storedAvatarParts(avatar) ? '' : avatar;
}

export async function resolveAvatarImageUrl(value, supabase) {
  const avatar = validAvatar(value);
  const parts = storedAvatarParts(avatar);
  if (!parts) return avatar;
  if (!supabase?.storage) return '';
  const { data, error } = await supabase.storage
    .from(PROFILE_AVATAR_BUCKET)
    .createSignedUrl(`${parts.userId}/avatar.jpg`, 3600);
  if (error) return '';
  return String(data?.signedUrl || '');
}
