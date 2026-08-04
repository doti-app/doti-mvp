import {
  extractWebhookStatuses,
  sha256Hex,
  technicalLog,
  validWebhookSignature
} from '../_shared/meta-campaign.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const LEGACY_ADMIN_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') || '';

function namedKey(environmentName: string) {
  try {
    const keys = JSON.parse(Deno.env.get(environmentName) || '{}');
    return typeof keys.default === 'string' ? keys.default : '';
  } catch {
    return '';
  }
}

const ADMIN_KEY = LEGACY_ADMIN_KEY || namedKey('SUPABASE_SECRET_KEYS');

function text(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function serviceHeaders() {
  const headers: Record<string, string> = { apikey: ADMIN_KEY, 'Content-Type': 'application/json' };
  if (ADMIN_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${ADMIN_KEY}`;
  return headers;
}

async function rpc(name: string, body: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: serviceHeaders(), body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Webhook persistence failed (${response.status}).`);
  return payload;
}

Deno.serve(async request => {
  const startedAt = performance.now();
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
      return text(200, challenge);
    }
    return text(403, 'Verificação rejeitada.');
  }
  if (request.method !== 'POST') return text(405, 'Método não permitido.');
  if (!SUPABASE_URL || !ADMIN_KEY || !APP_SECRET) return json(503, { error: 'Webhook não configurado.' });
  if (Number(request.headers.get('content-length') || 0) > 1024 * 1024) {
    return json(413, { error: 'Notificação excede o limite permitido.' });
  }

  const rawBody = await request.text();
  if (!(await validWebhookSignature(rawBody, request.headers.get('x-hub-signature-256') || '', APP_SECRET))) {
    return json(401, { error: 'Assinatura inválida ou ausente.' });
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'Notificação JSON inválida.' });
  }
  if (payload.object !== 'whatsapp_business_account') {
    return json(400, { error: 'Tipo de notificação inválido.' });
  }

  const events = extractWebhookStatuses(payload);
  const results = await Promise.allSettled(events.map(async event => rpc('record_meta_delivery_event', {
    p_phone_number_id: event.phoneNumberId,
    p_meta_message_id: event.metaMessageId,
    p_event_type: event.eventType,
    p_occurred_at: event.occurredAt,
    p_error_code: event.errorCode,
    p_error_message: event.errorMessage,
    p_event_fingerprint: await sha256Hex(event.fingerprintSource),
    p_event_metadata: event.metadata
  })));
  const rejected = results.filter(result => result.status === 'rejected').length;
  technicalLog(rejected ? 'error' : 'info', 'meta.webhook.batch', {
    received: events.length,
    rejected,
    durationMs: Math.round(performance.now() - startedAt)
  });
  return json(200, { received: true, events: events.length });
});
