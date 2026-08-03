const TRANSIENT_META_CODES = new Set([1, 2, 4, 17, 32, 613]);
const DELIVERY_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);
const SENSITIVE_LOG_KEY = /(authorization|token|secret|phone|recipient|wamid|message|content|body|variables)/i;
const UNSTRUCTURED_LOG_KEY = /^(error|reason|detail|description)s?$/i;

function hexadecimal(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function validWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!/^sha256=[0-9a-f]{64}$/i.test(signatureHeader) || !appSecret) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return constantTimeEqual(hexadecimal(signature), signatureHeader.slice(7).toLowerCase());
}

export async function sha256Hex(value) {
  return hexadecimal(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export function classifyMetaFailure(httpStatus, payload, networkError = false) {
  const error = payload?.error || {};
  const code = String(error.code ?? '');
  const numericCode = Number(error.code || 0);
  const transient = networkError
    || [408, 409, 425, 429].includes(Number(httpStatus))
    || Number(httpStatus) >= 500
    || TRANSIENT_META_CODES.has(numericCode);
  return {
    transient,
    code: code || (networkError ? 'NETWORK_ERROR' : `HTTP_${httpStatus || 0}`),
    message: networkError
      ? 'Falha temporária de rede ao contatar a Meta.'
      : transient
        ? 'Falha temporária ao enviar pela Meta; uma nova tentativa poderá ser realizada.'
        : 'A Meta rejeitou o envio. Consulte o código técnico para corrigir os dados.'
  };
}

function redactSensitiveText(value) {
  return String(value)
    .replace(/Bearer\s+\S+/gi, '[REDACTED]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[REDACTED]')
    .replace(/\b(?:EAA|EAAG|eyJ)[A-Za-z0-9._-]{20,}\b/g, '[REDACTED]');
}

export function sanitizeTechnicalMetadata(value, key = '') {
  if (SENSITIVE_LOG_KEY.test(key) || UNSTRUCTURED_LOG_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeTechnicalMetadata(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeTechnicalMetadata(childValue, childKey)
    ]));
  }
  if (typeof value === 'string') return redactSensitiveText(value).slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  return String(value).slice(0, 100);
}

export function safeMetaErrorMetadata(error, latencyMs) {
  return sanitizeTechnicalMetadata({
    errorCode: error?.code == null ? '' : String(error.code),
    errorSubcode: error?.error_subcode == null ? '' : String(error.error_subcode),
    errorType: String(error?.type || ''),
    latencyMs: Math.max(0, Math.min(86400000, Math.round(Number(latencyMs) || 0)))
  });
}

export function technicalLog(level, event, context = {}) {
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  logger(JSON.stringify({
    event: String(event).slice(0, 100),
    ...sanitizeTechnicalMetadata(context),
    timestamp: new Date().toISOString()
  }));
}

export function buildTemplateComponents(parameters, variables) {
  const groups = new Map();
  (Array.isArray(parameters) ? parameters : []).forEach(parameter => {
    const component = String(parameter?.component || 'body').toLowerCase();
    const name = String(parameter?.name || '').trim();
    const kind = String(parameter?.kind || 'text').toLowerCase();
    const value = String(variables?.[name] ?? '').trim();
    if (!name || !value) throw new Error(`Parâmetro obrigatório ausente: ${name || 'desconhecido'}.`);
    const item = kind === 'text'
      ? { type: 'text', text: value, ...(/^\d+$/.test(name) ? {} : { parameter_name: name }) }
      : { type: kind, [kind]: { link: value } };
    if (!groups.has(component)) groups.set(component, []);
    groups.get(component).push(item);
  });
  return [...groups].map(([type, groupedParameters]) => ({ type, parameters: groupedParameters }));
}

export function extractWebhookStatuses(payload) {
  const statuses = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      const phoneNumberId = String(value?.metadata?.phone_number_id || '');
      for (const status of Array.isArray(value?.statuses) ? value.statuses : []) {
        const eventType = String(status?.status || '').toLowerCase();
        if (!phoneNumberId || !status?.id || !DELIVERY_STATUSES.has(eventType)) continue;
        const error = Array.isArray(status.errors) ? status.errors[0] : null;
        const timestamp = Number(status.timestamp || 0);
        statuses.push({
          phoneNumberId,
          metaMessageId: String(status.id),
          eventType,
          occurredAt: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
          errorCode: error?.code == null ? '' : String(error.code),
          errorMessage: error ? 'A Meta informou uma falha de entrega. Consulte o código técnico.' : '',
          metadata: sanitizeTechnicalMetadata({
            conversationCategory: status.conversation?.origin?.type || '',
            billable: status.pricing?.billable ?? null,
            pricingCategory: status.pricing?.category || '',
            pricingModel: status.pricing?.pricing_model || '',
            errorCode: error?.code == null ? '' : String(error.code)
          }),
          fingerprintSource: JSON.stringify([
            phoneNumberId,
            status.id,
            eventType,
            status.timestamp || '',
            error?.code == null ? '' : String(error.code)
          ])
        });
      }
    }
  }
  return statuses;
}
