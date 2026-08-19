export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function accessTokenIssuedAt(accessToken) {
  try {
    const payload = String(accessToken || '').split('.')[1];
    if (!payload) return null;
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
    const decoded = JSON.parse(atob(normalized));
    return Number.isFinite(decoded.iat) ? new Date(decoded.iat * 1000) : null;
  } catch (_) {
    return null;
  }
}

export function sessionSignInDate(session) {
  const lastSignIn = new Date(session?.user?.last_sign_in_at || '');
  if (!Number.isNaN(lastSignIn.getTime())) return lastSignIn;
  return accessTokenIssuedAt(session?.access_token);
}

export function isSessionExpired(session, now = new Date()) {
  if (!session) return false;
  const signedInAt = sessionSignInDate(session);
  return !signedInAt || now.getTime() >= signedInAt.getTime() + SESSION_MAX_AGE_MS;
}

export async function getValidSession(supabase, now = new Date()) {
  const { data, error } = await supabase.auth.getSession();
  const session = data?.session || null;
  if (error || !session || !isSessionExpired(session, now)) {
    return { session, error, expired: false };
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
  if (signOutError) throw signOutError;
  return { session: null, error: null, expired: true };
}

export function scheduleSessionExpiry(supabase, session, onExpire, now = new Date()) {
  const signedInAt = sessionSignInDate(session);
  const expiresAt = signedInAt
    ? signedInAt.getTime() + SESSION_MAX_AGE_MS
    : now.getTime();
  const timer = setTimeout(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      onExpire();
    }
  }, Math.max(0, expiresAt - now.getTime()));
  return () => clearTimeout(timer);
}
