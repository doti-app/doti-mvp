import { getAuthConfig, getSupabase } from './supabase-client.js';

function startLocalMode() {
  const profile = {
    id: 'local-owner',
    agency_id: 'local-agency',
    email: 'local@doti.dev',
    full_name: 'Ambiente local',
    agency_name: 'Doti Sandbox',
    role: 'owner',
    is_active: true,
    avatar_url: ''
  };
  const user = {
    id: profile.id,
    email: profile.email,
    user_metadata: {
      full_name: profile.full_name,
      agency_name: profile.agency_name
    }
  };
  const session = { user, access_token: 'local-only' };

  const profileElement = document.querySelector('.profile');
  if (profileElement) {
    profileElement.querySelector('strong').textContent = profile.full_name;
    profileElement.querySelector('small').textContent = 'Doti Sandbox · proprietario';
    profileElement.querySelector('.avatar').textContent = 'DL';
    profileElement.title = 'Modo local seguro';
  }

  const banner = document.createElement('div');
  banner.className = 'local-mode-banner';
  banner.innerHTML = '<strong>Modo local seguro</strong><span>Dados somente neste navegador</span>';
  document.body.appendChild(banner);

  document.body.dataset.userRole = profile.role;
  document.body.dataset.localMode = 'true';
  window.dotiAuthContext = {
    localMode: true,
    supabase: null,
    session,
    user,
    profile
  };

  document.getElementById('logoutButton')?.addEventListener('click', () => {
    alert('O modo local seguro nao usa login e nao esta conectado ao Supabase.');
  });

  document.documentElement.classList.remove('auth-pending');
  window.dispatchEvent(new CustomEvent('doti:auth-ready', {
    detail: window.dotiAuthContext
  }));
}

function validAvatar(value) {
  return /^\/assets\/avatars-users\/avatar-(0[1-9]|[12][0-9]|30)\.png$/.test(String(value || ''))
    ? String(value)
    : '';
}

function renderAvatar(element, profile) {
  if (!element) return;
  const avatarUrl = validAvatar(profile.avatar_url);
  element.replaceChildren();
  element.classList.toggle('has-image', Boolean(avatarUrl));
  if (avatarUrl) {
    const image = document.createElement('img');
    image.src = avatarUrl;
    image.alt = '';
    element.appendChild(image);
    return;
  }
  element.textContent = String(profile.full_name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

async function protectPanel() {
  try {
    const config = await getAuthConfig();
    if (config.localMode) {
      startLocalMode();
      return;
    }
    const supabase = await getSupabase();
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session) {
      location.replace('/dot-admin/?reason=expired');
      return;
    }

    const user = session.user;
    let { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, agency_id, email, full_name, agency_name, role, is_active, avatar_url')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError && String(profileError.message).includes('avatar_url')) {
      const fallback = await supabase
        .from('profiles')
        .select('id, agency_id, email, full_name, agency_name, role, is_active')
        .eq('id', user.id)
        .maybeSingle();
      profile = fallback.data ? { ...fallback.data, avatar_url: '' } : null;
      profileError = fallback.error;
    }
    if (profileError && String(profileError.message).includes('is_active')) {
      const fallback = await supabase
        .from('profiles')
        .select('id, agency_id, email, full_name, agency_name, role')
        .eq('id', user.id)
        .maybeSingle();
      profile = fallback.data ? { ...fallback.data, is_active: true, avatar_url: '' } : null;
      profileError = fallback.error;
    }
    if (profileError) throw profileError;

    if (!profile || profile.is_active === false) {
      await supabase.auth.signOut();
      location.replace('/dot-admin/?error=disabled');
      return;
    }

    const fullName = profile.full_name;
    const agencyName = profile.agency_name;
    const roleLabels = {
      owner: 'proprietário',
      admin: 'administrador',
      member: 'membro',
      viewer: 'visualizador'
    };
    const profileElement = document.querySelector('.profile');
    if (profileElement) {
      profileElement.querySelector('strong').textContent = fullName;
      profileElement.querySelector('small').textContent = `${agencyName} · ${roleLabels[profile?.role] || 'membro'}`;
      renderAvatar(profileElement.querySelector('.avatar'), profile);
      profileElement.title = user.email;
    }

    document.body.dataset.userRole = profile.role;
    window.dotiAuthContext = { supabase, session, user, profile };

    document.getElementById('logoutButton')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      location.replace('/dot-admin/');
    });

    supabase.auth.onAuthStateChange((event, nextSession) => {
      if (nextSession && window.dotiAuthContext) {
        window.dotiAuthContext.session = nextSession;
      }
      if (event === 'SIGNED_OUT') location.replace('/dot-admin/');
    });
    document.documentElement.classList.remove('auth-pending');
    window.dispatchEvent(new CustomEvent('doti:auth-ready', {
      detail: window.dotiAuthContext
    }));
  } catch (_) {
    location.replace('/dot-admin/?error=config');
  }
}

protectPanel();
