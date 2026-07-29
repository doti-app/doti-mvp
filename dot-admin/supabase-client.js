import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

let clientPromise;

export function getSupabase() {
  if (!clientPromise) {
    clientPromise = fetch('/api/auth-config', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
      .then(async response => {
        const config = await response.json().catch(() => ({}));
        if (!response.ok || !config.configured) {
          throw new Error(config.message || 'Não foi possível carregar a configuração de autenticação.');
        }
        return createClient(config.supabaseUrl, config.supabasePublishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: 'pkce',
            storageKey: 'doti-auth'
          }
        });
      });
  }
  return clientPromise;
}

export function authUrl(params = '') {
  const base = `${location.origin}/dot-admin/`;
  return params ? `${base}?${params}` : base;
}
