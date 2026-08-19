import {
  PROFILE_AVATAR_BUCKET,
  createStoredAvatarReference,
  isLocalPhoto,
  resolveAvatarImageUrl,
  storedAvatarParts,
  storedAvatarPath,
  validAvatar
} from '../../shared/profile-avatar.js';

/** @param {{ auth: any, events?: EventTarget, document?: Document }} dependencies */
export function createProfileDomain({ auth, events = new EventTarget(), document: documentRef = globalThis.document }) {
const document = documentRef;

const LOCAL_PROFILE_KEY = 'doti-local-profile-v1';
const LOCAL_TEAM_KEY = 'doti-local-team-v1';
const AVATAR_BASE = '/assets/avatars-users';
const AVATARS = Array.from(
  { length: 30 },
  (_, index) => `${AVATAR_BASE}/avatar-${String(index + 1).padStart(2, '0')}.png`
);

const ROLE_LABELS = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Visualizador'
};

const form = document.getElementById('profileSettingsForm');
const fullNameInput = document.getElementById('profileFullName');
const emailInput = document.getElementById('profileEmail');
const roleInput = document.getElementById('profileRole');
const avatarPicker = document.getElementById('profileAvatarPicker');
const avatarPreview = document.getElementById('profileAvatarPreview');
const avatarPreviewWrap = document.getElementById('profileAvatarPreviewWrap');
const avatarRemoveButton = document.getElementById('profileAvatarRemove');
const photoInput = document.getElementById('profilePhotoInput');
const photoLabel = document.getElementById('profilePhotoLabel');
const saveStatus = document.getElementById('profileSaveStatus');
const storageHint = document.getElementById('profileStorageHint');

let authContext;
let selectedAvatar = '';

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

async function setAvatar(element, avatarUrl, fullName) {
  if (!element) return;
  element.replaceChildren();
  const safeAvatar = validAvatar(avatarUrl);
  element.classList.toggle('has-image', Boolean(safeAvatar));
  element.classList.toggle('has-custom-photo', isLocalPhoto(safeAvatar) || Boolean(storedAvatarParts(safeAvatar)));
  if (element === avatarPreview) {
    avatarPreviewWrap.classList.toggle('has-image', Boolean(safeAvatar));
  }
  if (!safeAvatar) {
    element.textContent = initials(fullName);
    return;
  }
  const imageUrl = await resolveAvatarImageUrl(safeAvatar, authContext?.supabase);
  if (!imageUrl) {
    element.classList.remove('has-image', 'has-custom-photo');
    if (element === avatarPreview) avatarPreviewWrap.classList.remove('has-image');
    element.textContent = initials(fullName);
    return;
  }
  const image = document.createElement('img');
  image.src = imageUrl;
  image.alt = '';
  element.appendChild(image);
}

function readLocalProfile(baseProfile) {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return {
        ...baseProfile,
        full_name: String(saved.full_name || baseProfile.full_name),
        avatar_url: validAvatar(saved.avatar_url)
      };
    }
  } catch (_) {}
  return { ...baseProfile, avatar_url: validAvatar(baseProfile.avatar_url) };
}

function syncLocalTeam(profile) {
  try {
    const team = JSON.parse(localStorage.getItem(LOCAL_TEAM_KEY) || 'null');
    if (!team?.members) return;
    const member = team.members.find(item => item.id === profile.id);
    if (!member) return;
    member.full_name = profile.full_name;
    member.avatar_url = profile.avatar_url;
    localStorage.setItem(LOCAL_TEAM_KEY, JSON.stringify(team));
  } catch (_) {}
}

function showStatus(message, attention = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle('error', attention);
}

let toastTimer;
function showToast(title, message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.querySelector(':scope > span').textContent = '✓';
  toast.querySelector('strong').textContent = title;
  toast.querySelector('p').textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a foto selecionada.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('O arquivo selecionado não é uma imagem válida.'));
      image.onload = () => resolve(image);
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

async function preparePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Escolha uma foto JPG, PNG ou WebP.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('A foto deve ter no máximo 5 MB.');
  }

  const image = await imageFromFile(file);
  const size = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = (image.naturalWidth - size) / 2;
  const sourceY = (image.naturalHeight - size) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, sourceX, sourceY, size, size, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.84);
}

async function applyProfile(profile) {
  fullNameInput.value = profile.full_name || '';
  emailInput.value = profile.email || authContext?.user?.email || '';
  roleInput.value = ROLE_LABELS[profile.role] || 'Membro';
  selectedAvatar = validAvatar(profile.avatar_url);
  photoLabel.textContent = (isLocalPhoto(selectedAvatar) || storedAvatarParts(selectedAvatar))
    ? 'Foto selecionada'
    : 'Nenhuma foto enviada';

  await Promise.all([
    setAvatar(avatarPreview, selectedAvatar, profile.full_name),
    setAvatar(document.querySelector('.profile .avatar'), selectedAvatar, profile.full_name)
  ]);

  const sidebarProfile = document.querySelector('.profile');
  if (sidebarProfile) {
    sidebarProfile.querySelector('strong').textContent = profile.full_name;
  }

  avatarPicker.querySelectorAll('[data-avatar]').forEach(button => {
    const selected = button.dataset.avatar === selectedAvatar;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function renderAvatarPicker() {
  avatarPicker.innerHTML = AVATARS.map((avatar, index) => `
    <button type="button" data-avatar="${avatar}" aria-label="Escolher avatar ${index + 1}" aria-pressed="false">
      <img src="${avatar}" alt="" loading="lazy">
    </button>
  `).join('');
}

async function initializeProfile(context) {
  authContext = context;
  const profile = context.localMode
    ? readLocalProfile(context.profile)
    : { ...context.profile, avatar_url: validAvatar(context.profile.avatar_url) };

  context.profile = profile;
  if (context.localMode) syncLocalTeam(profile);

  storageHint.textContent = context.supportMode
    ? 'Você está usando sua identidade DOT. Edite este perfil pelo portal interno.'
    : context.localMode
      ? 'No modo local, as alterações ficam somente neste navegador.'
      : 'Nome e avatar são salvos com segurança no perfil da sua conta.';
  form.querySelector('[type="submit"]').disabled = Boolean(context.supportMode);
  await applyProfile(profile);

  if (context.supportMode) {
    fullNameInput.readOnly = true;
    avatarPicker.querySelectorAll('button').forEach(button => { button.disabled = true; });
    avatarRemoveButton.disabled = true;
  }

  photoInput.disabled = Boolean(context.supportMode);
  photoInput.closest('.profile-photo-upload')?.classList.toggle('is-disabled', Boolean(context.supportMode));
  if (context.supportMode) photoLabel.textContent = 'Edite a foto pelo portal interno';
}

renderAvatarPicker();

avatarPicker.addEventListener('click', async event => {
  const button = event.target.closest('[data-avatar]');
  if (!button) return;
  selectedAvatar = button.dataset.avatar;
  photoLabel.textContent = 'Nenhuma foto enviada';
  avatarPicker.querySelectorAll('[data-avatar]').forEach(item => {
    const selected = item === button;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  await setAvatar(avatarPreview, selectedAvatar, fullNameInput.value);
  showStatus('');
});

photoInput.addEventListener('change', async () => {
  const [file] = photoInput.files;
  if (!file) return;
  showStatus('Preparando sua foto...');
  try {
    selectedAvatar = await preparePhoto(file);
    avatarPicker.querySelectorAll('[data-avatar]').forEach(item => {
      item.classList.remove('selected');
      item.setAttribute('aria-pressed', 'false');
    });
    photoLabel.textContent = file.name;
    await setAvatar(avatarPreview, selectedAvatar, fullNameInput.value);
    showStatus('Foto pronta. Clique em salvar alterações para confirmar.');
  } catch (error) {
    showStatus(error.message || 'Não foi possível usar essa foto.', true);
  } finally {
    photoInput.value = '';
  }
});

avatarRemoveButton.addEventListener('click', async () => {
  selectedAvatar = '';
  avatarPicker.querySelectorAll('[data-avatar]').forEach(item => {
    item.classList.remove('selected');
    item.setAttribute('aria-pressed', 'false');
  });
  photoLabel.textContent = 'Nenhuma foto enviada';
  await setAvatar(avatarPreview, selectedAvatar, fullNameInput.value);
  showStatus('Imagem removida. Clique em salvar alterações para confirmar.');
});

fullNameInput.addEventListener('input', async () => {
  await setAvatar(avatarPreview, selectedAvatar, fullNameInput.value);
  showStatus('');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (authContext.supportMode) {
    showStatus('Volte ao portal DOT para atualizar seu perfil interno.', true);
    return;
  }
  const fullName = fullNameInput.value.trim();
  if (fullName.length < 2) {
    showStatus('Informe um nome com pelo menos 2 caracteres.', true);
    fullNameInput.focus();
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Salvando…';
  showStatus('');

  try {
    let profile;
    if (authContext.localMode) {
      profile = {
        ...authContext.profile,
        full_name: fullName,
        avatar_url: selectedAvatar
      };
      localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify({
        full_name: profile.full_name,
        avatar_url: profile.avatar_url
      }));
      syncLocalTeam(profile);
    } else {
      const previousAvatar = validAvatar(authContext.profile.avatar_url, { allowLocalPhoto: false });
      let avatarForSave = selectedAvatar;
      if (isLocalPhoto(selectedAvatar)) {
        const photoBlob = await fetch(selectedAvatar).then(response => response.blob());
        const avatarReference = createStoredAvatarReference(authContext.user.id);
        const { error: uploadError } = await authContext.supabase.storage
          .from(PROFILE_AVATAR_BUCKET)
          .upload(storedAvatarPath(avatarReference), photoBlob, {
            cacheControl: '3600',
            contentType: 'image/jpeg',
            upsert: true
          });
        if (uploadError) throw new Error(uploadError.message || 'Não foi possível enviar a foto.');
        avatarForSave = avatarReference;
      }
      const { data, error } = await authContext.supabase.functions.invoke('team-admin', {
        body: {
          action: 'update_profile',
          fullName,
          avatarUrl: avatarForSave
        }
      });
      if (error) {
        let message = error.message;
        try {
          const payload = await error.context?.json();
          message = payload?.error || message;
        } catch (_) {}
        throw new Error(message || 'Não foi possível atualizar o perfil.');
      }
      profile = data?.profile;
      if (!profile) throw new Error('O perfil atualizado não foi retornado.');
      if (storedAvatarParts(previousAvatar) && !storedAvatarParts(avatarForSave)) {
        await authContext.supabase.storage
          .from(PROFILE_AVATAR_BUCKET)
          .remove([storedAvatarPath(previousAvatar)])
          .catch(() => {});
      }
    }

    authContext.profile = profile;
    if (authContext.user?.user_metadata) {
      authContext.user.user_metadata.full_name = profile.full_name;
    }
    await applyProfile(profile);
    showStatus(authContext.localMode
      ? 'Alterações salvas somente neste navegador.'
      : 'Alterações salvas no seu perfil.');
    showToast('Perfil atualizado', 'Seu nome e imagem de perfil foram atualizados.');
    events.dispatchEvent(new CustomEvent('profile-updated', { detail: profile }));
  } catch (error) {
    showStatus(error.message || 'Não foi possível atualizar o perfil.', true);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Salvar alterações';
  }
});

let mounted = false;
return {
  id: 'profile',
  async mount() {
    if (mounted) return;
    mounted = true;
    await initializeProfile(auth);
  },
  unmount() {
    mounted = false;
  }
};
}
