import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWhatsappReleaseReadiness } from './check-whatsapp-release-readiness.mjs';

test('aprova tabelas existentes e funções protegidas na borda anônima', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes('meta-webhook')) return { status: 403 };
    if (url.includes('meta-integration')) return { status: 401 };
    return { status: 200 };
  };

  const result = await checkWhatsappReleaseReadiness({
    baseUrl: 'https://project.supabase.co/',
    publishableKey: 'sb_publishable_test',
    fetchImpl
  });

  assert.equal(result.ready, true);
  assert.equal(result.checks.length, 8);
  assert.equal(requests.filter(request => request.url.includes('/rest/v1/')).length, 6);
  assert.ok(requests.every(request => !JSON.stringify(request).includes('access-token')));
});

test('reprova artefatos ausentes, função exposta e falha de rede', async () => {
  const fetchImpl = async url => {
    if (url.includes('meta_whatsapp_rollouts')) return { status: 404 };
    if (url.includes('meta-webhook')) return { status: 200 };
    if (url.includes('meta-integration')) throw new Error('network');
    return { status: 200 };
  };

  const result = await checkWhatsappReleaseReadiness({
    baseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    fetchImpl
  });

  assert.equal(result.ready, false);
  assert.deepEqual(
    result.checks.filter(check => !check.ready).map(check => [check.name, check.status]),
    [
      ['table:meta_whatsapp_rollouts', 404],
      ['function:meta-webhook', 200],
      ['function:meta-integration', 0]
    ]
  );
});

test('exige somente URL e chave publicável, sem credencial administrativa', async () => {
  await assert.rejects(
    checkWhatsappReleaseReadiness({ baseUrl: '', publishableKey: 'key', fetchImpl: async () => ({ status: 200 }) }),
    /SUPABASE_URL/
  );
  await assert.rejects(
    checkWhatsappReleaseReadiness({ baseUrl: 'https://project.supabase.co', publishableKey: '' }),
    /SUPABASE_PUBLISHABLE_KEY/
  );
});
