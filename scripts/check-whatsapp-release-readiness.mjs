import { pathToFileURL } from 'node:url';

const TABLES = [
  'meta_whatsapp_rollouts',
  'meta_connections',
  'meta_templates',
  'meta_campaigns',
  'meta_campaign_recipients',
  'meta_delivery_events'
];

async function requestStatus(fetchImpl, url, options = {}) {
  try {
    const response = await fetchImpl(url, options);
    return response.status;
  } catch {
    return 0;
  }
}

export async function checkWhatsappReleaseReadiness({ baseUrl, publishableKey, fetchImpl = fetch }) {
  const normalizedUrl = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(normalizedUrl)) throw new Error('SUPABASE_URL ausente ou inválida.');
  if (!String(publishableKey || '').trim()) throw new Error('SUPABASE_PUBLISHABLE_KEY ausente.');

  const checks = [];
  for (const table of TABLES) {
    const status = await requestStatus(
      fetchImpl,
      `${normalizedUrl}/rest/v1/${table}?select=id&limit=1`,
      { headers: { apikey: publishableKey } }
    );
    checks.push({ name: `table:${table}`, status, ready: status > 0 && status !== 404 });
  }

  const webhookStatus = await requestStatus(
    fetchImpl,
    `${normalizedUrl}/functions/v1/meta-webhook?hub.mode=subscribe&hub.verify_token=readiness-invalid&hub.challenge=x`
  );
  checks.push({ name: 'function:meta-webhook', status: webhookStatus, ready: webhookStatus === 403 });

  const integrationStatus = await requestStatus(fetchImpl, `${normalizedUrl}/functions/v1/meta-integration`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  checks.push({ name: 'function:meta-integration', status: integrationStatus, ready: integrationStatus === 401 });

  return { ready: checks.every(check => check.ready), checks };
}

async function main() {
  const result = await checkWhatsappReleaseReadiness({
    baseUrl: process.env.SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
  });
  result.checks.forEach(check => {
    console.log(`${check.ready ? 'PASS' : 'FAIL'} ${check.name} HTTP ${check.status || 'network-error'}`);
  });
  if (!result.ready) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`FAIL readiness ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    process.exitCode = 1;
  });
}
