import { getSupabase } from './supabase-client.js';

async function protectPanel() {
  try {
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
      .select('id, agency_id, email, full_name, agency_name, role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError && String(profileError.message).includes('is_active')) {
      const fallback = await supabase
        .from('profiles')
        .select('id, agency_id, email, full_name, agency_name, role')
        .eq('id', user.id)
        .maybeSingle();
      profile = fallback.data ? { ...fallback.data, is_active: true } : null;
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
    const initials = fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();

    const profileElement = document.querySelector('.profile');
    if (profileElement) {
      profileElement.querySelector('strong').textContent = fullName;
      profileElement.querySelector('small').textContent = `${agencyName} · ${roleLabels[profile?.role] || 'membro'}`;
      profileElement.querySelector('.avatar').textContent = initials;
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
