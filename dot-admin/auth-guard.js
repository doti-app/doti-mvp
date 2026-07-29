import { getSupabase } from './supabase-client.js';

async function protectPanel() {
  try {
    const supabase = await getSupabase();
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session) {
      location.replace('dot-admin/?reason=expired');
      return;
    }

    const user = session.user;
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, agency_name, role')
      .eq('id', user.id)
      .maybeSingle();

    const fullName = profile?.full_name || user.user_metadata?.full_name || user.email.split('@')[0];
    const agencyName = profile?.agency_name || user.user_metadata?.agency_name || 'Sua agência';
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
      profileElement.querySelector('small').textContent = `${agencyName} · ${profile?.role || 'membro'}`;
      profileElement.querySelector('.avatar').textContent = initials;
      profileElement.title = user.email;
    }

    document.getElementById('logoutButton')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      location.replace('dot-admin/');
    });

    supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') location.replace('dot-admin/');
    });
    document.documentElement.classList.remove('auth-pending');
  } catch (_) {
    location.replace('dot-admin/?error=config');
  }
}

protectPanel();
