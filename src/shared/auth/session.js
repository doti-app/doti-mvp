import { getAuthConfig, getSupabase, getSupabaseForAgency } from './supabase-client.js';

let authContext = null;
let stopSubscription = () => {};

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
  authContext = {
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
  return authContext;
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

function addSupportBanner(agency, platformStaff) {
  const banner = document.createElement('div');
  banner.className = 'doti-support-banner';
  banner.innerHTML = `
    <div><strong>Modo de suporte DOT</strong><span></span></div>
    <a href="/doti/">Voltar ao portal DOT</a>`;
  banner.querySelector('span').textContent = `${agency.name} · ${platformStaff.role}`;
  document.body.prepend(banner);
}

async function accountContextFor(supabase) {
  const { data, error } = await supabase.rpc('get_account_context');
  if (error) {
    if (String(error.message || '').includes('get_account_context')) return null;
    throw error;
  }
  return data || null;
}

async function profileFor(supabase, userId) {
  let { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, agency_id, email, full_name, agency_name, role, is_active, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (profileError && String(profileError.message).includes('avatar_url')) {
    const fallback = await supabase
      .from('profiles')
      .select('id, agency_id, email, full_name, agency_name, role, is_active')
      .eq('id', userId)
      .maybeSingle();
    profile = fallback.data ? { ...fallback.data, avatar_url: '' } : null;
    profileError = fallback.error;
  }
  if (profileError && String(profileError.message).includes('is_active')) {
    const fallback = await supabase
      .from('profiles')
      .select('id, agency_id, email, full_name, agency_name, role')
      .eq('id', userId)
      .maybeSingle();
    profile = fallback.data ? { ...fallback.data, is_active: true, avatar_url: '' } : null;
    profileError = fallback.error;
  }
  if (profileError) throw profileError;
  return profile;
}

async function protectPanel() {
  try {
    const config = await getAuthConfig();
    if (config.localMode) {
      return startLocalMode();
    }
    const baseSupabase = await getSupabase();
    const { data: { session }, error } = await baseSupabase.auth.getSession();
    if (error) throw error;
    if (!session) {
      location.replace('/dot-admin/?reason=expired');
      return;
    }

    const user = session.user;
    const accountContext = await accountContextFor(baseSupabase);
    const supportAgencyId = new URLSearchParams(location.search).get('supportAgency');
    let supabase = baseSupabase;
    let profile;
    let supportMode = false;
    let supportAgency = null;
    const platformStaff = accountContext?.platform || null;

    if (supportAgencyId) {
      if (!platformStaff?.isActive) {
        location.replace('/doti/?error=platform-access');
        return;
      }
      supabase = await getSupabaseForAgency(supportAgencyId);
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('id,name,status')
        .eq('id', supportAgencyId)
        .maybeSingle();
      if (agencyError || !agency || agency.status !== 'active') {
        location.replace('/doti/?error=agency-unavailable');
        return;
      }
      supportMode = true;
      supportAgency = agency;
      profile = {
        id: user.id,
        agency_id: agency.id,
        email: platformStaff.email || user.email,
        full_name: platformStaff.fullName,
        agency_name: agency.name,
        role: platformStaff.role,
        is_active: true,
        avatar_url: platformStaff.avatarUrl || '',
        is_doti_staff: true
      };
      const { error: entryError } = await baseSupabase.functions.invoke('platform-admin', {
        body: { action: 'record_agency_entry', agencyId: agency.id }
      });
      if (entryError) console.warn('Não foi possível registrar a entrada de suporte.', entryError);
    } else {
      if (accountContext?.personalAgency?.status === 'archived') {
        if (platformStaff?.isActive) {
          location.replace('/doti/?error=personal-agency-archived');
          return;
        }
        await baseSupabase.auth.signOut();
        location.replace('/dot-admin/?error=agency-archived');
        return;
      }
      profile = await profileFor(baseSupabase, user.id);
      if (!profile || profile.is_active === false) {
        if (platformStaff?.isActive) {
          location.replace('/doti/');
          return;
        }
        await baseSupabase.auth.signOut();
        location.replace('/dot-admin/?error=disabled');
        return;
      }
    }

    if (!supportMode && profile.role !== 'owner') {
      const { error: invitationError } = await supabase.functions.invoke('team-admin', {
        body: { action: 'accept_invite' }
      });
      if (invitationError) {
        console.warn('Não foi possível finalizar o convite neste acesso.', invitationError);
      }
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
      profileElement.querySelector('small').textContent = supportMode
        ? `${agencyName} · suporte DOT ${roleLabels[profile?.role] || 'membro'}`
        : `${agencyName} · ${roleLabels[profile?.role] || 'membro'}`;
      renderAvatar(profileElement.querySelector('.avatar'), profile);
      profileElement.title = user.email;
    }

    document.body.dataset.userRole = profile.role;
    document.body.dataset.supportMode = String(supportMode);
    if (supportMode) addSupportBanner(supportAgency, platformStaff);
    authContext = {
      supabase,
      baseSupabase,
      session,
      user,
      profile,
      accountContext,
      platformStaff,
      supportMode,
      supportAgency
    };

    document.getElementById('logoutButton')?.addEventListener('click', async () => {
      await baseSupabase.auth.signOut();
      location.replace('/dot-admin/');
    });

    const { data } = baseSupabase.auth.onAuthStateChange((event, nextSession) => {
      if (nextSession && authContext) {
        authContext.session = nextSession;
      }
      if (event === 'SIGNED_OUT') location.replace('/dot-admin/');
    });
    stopSubscription = () => data.subscription.unsubscribe();
    document.documentElement.classList.remove('auth-pending');
    return authContext;
  } catch (_) {
    location.replace('/dot-admin/?error=config');
    return null;
  }
}

/**
 * Resolves the panel session once and exposes it to the composition root.
 * No feature reads authentication through `window` or lifecycle events.
 */
export function createProtectedSession() {
  return {
    start: protectPanel,
    stop() {
      stopSubscription();
      stopSubscription = () => {};
      authContext = null;
    },
    get context() {
      return authContext;
    }
  };
}
