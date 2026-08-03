import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  buildTemplateComponents,
  classifyMetaFailure,
  extractWebhookStatuses,
  safeMetaErrorMetadata,
  sanitizeTechnicalMetadata,
  validWebhookSignature
} from './meta-campaign.mjs';

test('classifica rede, limite e servidor como transitórios sem repetir erro permanente', () => {
  assert.equal(classifyMetaFailure(0, null, true).transient, true);
  assert.equal(classifyMetaFailure(429, { error: { code: 4 } }).transient, true);
  assert.equal(classifyMetaFailure(503, { error: { code: 2 } }).transient, true);
  assert.equal(classifyMetaFailure(400, { error: { code: 100, message: 'Invalid parameter' } }).transient, false);
  assert.equal(classifyMetaFailure(400, { error: { code: 132001, message: 'Template does not exist' } }).transient, false);
});

test('monta componentes posicionais, nomeados e de mídia para template', () => {
  assert.deepEqual(buildTemplateComponents([
    { component: 'body', name: '1', kind: 'text' },
    { component: 'body', name: 'cliente', kind: 'text' },
    { component: 'header', name: 'media', kind: 'image' }
  ], { 1: 'Ana', cliente: 'Doti', media: 'https://example.com/banner.png' }), [
    { type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'Doti', parameter_name: 'cliente' }] },
    { type: 'header', parameters: [{ type: 'image', image: { link: 'https://example.com/banner.png' } }] }
  ]);
  assert.throws(() => buildTemplateComponents([{ component: 'body', name: '1', kind: 'text' }], {}), /obrigatório/);
});

test('extrai somente estados de entrega suportados do webhook', () => {
  const statuses = extractWebhookStatuses({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: 'phone-1' },
    statuses: [
      { id: 'wamid.1', status: 'delivered', timestamp: '1700000000', conversation: { id: 'c1' } },
      { id: 'wamid.2', status: 'deleted', timestamp: '1700000001' }
    ]
  } }] }] });
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].eventType, 'delivered');
  assert.equal(statuses[0].phoneNumberId, 'phone-1');
});

test('valida a assinatura HMAC e rejeita assinatura ausente ou adulterada', async () => {
  const body = '{"object":"whatsapp_business_account"}';
  const signature = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
  assert.equal(await validWebhookSignature(body, signature, 'app-secret'), true);
  assert.equal(await validWebhookSignature(`${body} `, signature, 'app-secret'), false);
  assert.equal(await validWebhookSignature(body, '', 'app-secret'), false);
});

test('remove telefone, token, conteúdo e variáveis de metadados técnicos', () => {
  const sanitized = sanitizeTechnicalMetadata({
    phone: '+5511999999999',
    authorization: 'Bearer segredo-super-longo',
    variables: { nome: 'Ana' },
    error: 'Falha para +55 (11) 99999-9999 com o conteúdo Olá Ana',
    campaignId: 'campanha-interna',
    latencyMs: 321
  });
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /5511999999999|99999-9999|segredo-super-longo|Olá Ana/);
  assert.equal(sanitized.error, '[REDACTED]');
  assert.equal(sanitized.campaignId, 'campanha-interna');
  assert.equal(sanitized.latencyMs, 321);
});

test('persiste somente códigos seguros da falha Meta e latência limitada', () => {
  assert.deepEqual(safeMetaErrorMetadata({
    code: 100,
    error_subcode: 2494010,
    type: 'OAuthException',
    message: 'Token EAAsegredo e telefone +5511999999999'
  }, 87.6), {
    errorCode: '100',
    errorSubcode: '2494010',
    errorType: 'OAuthException',
    latencyMs: 88
  });
});

test('webhook não carrega detalhes sensíveis de erro para persistência', () => {
  const [event] = extractWebhookStatuses({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: 'phone-1' },
    statuses: [{
      id: 'wamid.failure', status: 'failed', timestamp: '1700000000',
      errors: [{ code: 131026, message: 'Falha em +5511999999999', error_data: { details: 'Olá Ana' } }]
    }]
  } }] }] });
  assert.equal(event.errorCode, '131026');
  assert.doesNotMatch(JSON.stringify(event), /5511999999999|Olá Ana/);
});
