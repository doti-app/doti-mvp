let clientPromise;
let configPromise;
const scopedClientPromises = new Map();

function clientOptions(headers = {}) {
  return {
    global: { headers },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'doti-auth'
    }
  };
}

export function getAuthConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/auth-config', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    }).then(async response => {
      const config = await response.json().catch(() => ({}));
      if (!response.ok || !config.configured) {
        throw new Error(config.message || 'Nao foi possivel carregar a configuracao de autenticacao.');
      }
      return config;
    });
  }
  return configPromise;
}

export function getSupabase() {
  if (!clientPromise) {
    clientPromise = getAuthConfig().then(config => {
      if (config.localMode) {
        throw new Error('Supabase desativado no modo local seguro.');
      }
      if (!globalThis.supabase?.createClient) {
        throw new Error('O cliente do Supabase nao foi carregado.');
      }
      return globalThis.supabase.createClient(
        config.supabaseUrl,
        config.supabasePublishableKey,
        clientOptions()
      );
    });
  }
  return clientPromise;
}

export function getSupabaseForAgency(agencyId) {
  const id = String(agencyId || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return Promise.reject(new Error('Agência de suporte inválida.'));
  }
  if (!scopedClientPromises.has(id)) {
    scopedClientPromises.set(id, getAuthConfig().then(config => {
      if (!globalThis.supabase?.createClient) {
        throw new Error('O cliente do Supabase nao foi carregado.');
      }
      return globalThis.supabase.createClient(
        config.supabaseUrl,
        config.supabasePublishableKey,
        clientOptions({ 'X-Doti-Agency-Id': id })
      );
    }));
  }
  return scopedClientPromises.get(id);
}

export function authUrl(params = '') {
  const base = `${location.origin}/dot-admin/`;
  return params ? `${base}?${params}` : base;
}
