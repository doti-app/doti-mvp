/// <reference path="../_shared/edge-runtime.d.ts" />
import {
  buildTemplateComponents,
  classifyMetaFailure,
  safeMetaErrorMetadata,
  technicalLog
} from '../_shared/meta-campaign.mjs';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const LEGACY_PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const LEGACY_ADMIN_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ENCRYPTION_KEY = Deno.env.get('META_TOKEN_ENCRYPTION_KEY') || '';
const ENCRYPTION_KEY_VERSION = Number(Deno.env.get('META_TOKEN_ENCRYPTION_KEY_VERSION') || '1');
const META_GRAPH_VERSION = Deno.env.get('META_GRAPH_API_VERSION') || 'v24.0';
const META_GRAPH_ORIGIN = 'https://graph.facebook.com';

function namedKey(environmentName: string) {
  try {
    const keys = JSON.parse(Deno.env.get(environmentName) || '{}');
    return typeof keys.default === 'string' ? keys.default : '';
  } catch {
    return '';
  }
}

const PUBLIC_KEY = namedKey('SUPABASE_PUBLISHABLE_KEYS') || LEGACY_PUBLIC_KEY;
const ADMIN_KEY = LEGACY_ADMIN_KEY || namedKey('SUPABASE_SECRET_KEYS');

type Profile = {
  id: string;
  agency_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  is_active: boolean;
};

type Connection = {
  id: string;
  agency_id: string;
  whatsapp_business_account_id: string;
  phone_number_id: string;
};

type Rollout = {
  release_stage: 'disabled' | 'pilot' | 'general';
  sending_enabled: boolean;
};

type ApprovedTemplate = {
  id: string;
  name: string;
  language: string;
  category: 'authentication' | 'marketing' | 'utility';
  status: 'approved';
  components: unknown[];
  parameters: Array<{ component: string; name: string; kind: string }>;
  qualityScore: string;
};

type CampaignClaim = {
  campaign_id: string;
  recipient_id: string;
  phone_e164: string;
  template_variables: Record<string, string>;
  attempt_number: number;
  processing_token: string;
  idempotency_key: string;
  phone_number_id: string;
  template_name: string;
  template_language: string;
  template_parameters: Array<{ component: string; name: string; kind: string }>;
  token_ciphertext: string;
  token_iv: string;
  key_version: number;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class MetaError extends HttpError {}

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin') || '';
  if (
    origin === 'https://doti-mvp.vercel.app'
    || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
    || /^http:\/\/localhost(?::\d+)?$/i.test(origin)
    || /^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin)
  ) return origin;
  return 'https://doti-mvp.vercel.app';
}

function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-doti-agency-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    Vary: 'Origin'
  };
}

function json(request: Request, status: number, body: unknown) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function authorizationHeader(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Sessão ausente.');
  return authorization;
}

function serviceHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    apikey: ADMIN_KEY,
    'Content-Type': 'application/json',
    ...extra
  };
  if (ADMIN_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${ADMIN_KEY}`;
  return headers;
}

async function supabaseRequest(path: string, options: RequestInit = {}, authorization?: string) {
  const headers = authorization
    ? {
        apikey: PUBLIC_KEY,
        Authorization: authorization,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined)
      }
    : serviceHeaders(options.headers as Record<string, string> | undefined);
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new HttpError(401, 'Sua sessão expirou. Entre novamente.');
    if (response.status === 403) throw new HttpError(403, 'Você não tem permissão para esta configuração.');
    throw new HttpError(500, 'Não foi possível salvar a configuração do WhatsApp.');
  }
  return body;
}

async function authenticatedUser(request: Request) {
  const authorization = authorizationHeader(request);
  const user = await supabaseRequest('/auth/v1/user', { method: 'GET' }, authorization);
  if (!user?.id) throw new HttpError(401, 'Sessão inválida ou expirada.');
  return { user, authorization };
}

async function profileForUser(userId: string, requestedAgencyId = ''): Promise<Profile> {
  if (requestedAgencyId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedAgencyId)) {
      throw new HttpError(400, 'Agência de suporte inválida.');
    }
    const [staff, agencies] = await Promise.all([
      supabaseRequest(`/rest/v1/platform_staff?id=eq.${encodeURIComponent(userId)}&role=eq.admin&is_active=eq.true&select=id&limit=1`),
      supabaseRequest(`/rest/v1/agencies?id=eq.${encodeURIComponent(requestedAgencyId)}&status=eq.active&select=id&limit=1`)
    ]);
    if (!staff?.[0] || !agencies?.[0]) {
      throw new HttpError(403, 'Somente um administrador DOT pode configurar integrações em suporte.');
    }
    return { id: userId, agency_id: requestedAgencyId, role: 'admin', is_active: true };
  }
  const profiles = await supabaseRequest(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,agency_id,role,is_active&limit=1`
  );
  const profile = profiles?.[0];
  if (!profile?.is_active) throw new HttpError(403, 'Este usuário não possui acesso operacional ativo.');
  return profile;
}

async function managerContext(request: Request) {
  const { user, authorization } = await authenticatedUser(request);
  const requestedAgencyId = request.headers.get('x-doti-agency-id') || '';
  const profile = await profileForUser(user.id, requestedAgencyId);
  if (!['owner', 'admin'].includes(profile.role)) {
    throw new HttpError(403, 'Somente proprietário ou administrador pode configurar o WhatsApp.');
  }
  return { user, profile, authorization, requestedAgencyId };
}

async function assertWhatsappRollout(profile: Profile) {
  const rows = await supabaseRequest(
    `/rest/v1/meta_whatsapp_rollouts?agency_id=eq.${encodeURIComponent(profile.agency_id)}&select=release_stage,sending_enabled&limit=1`
  ) as Rollout[];
  const rollout = rows?.[0];
  if (!rollout?.sending_enabled || !['pilot', 'general'].includes(rollout.release_stage)) {
    throw new HttpError(403, 'O WhatsApp ainda não foi liberado para esta agência.');
  }
  return rollout;
}

function fromBase64(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    throw new HttpError(503, 'A criptografia da integração Meta está indisponível.');
  }
}

function toBase64(value: Uint8Array) {
  let binary = '';
  value.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function encryptionKey(usages: KeyUsage[]) {
  const keyBytes = fromBase64(ENCRYPTION_KEY);
  if (keyBytes.byteLength !== 32 || !Number.isInteger(ENCRYPTION_KEY_VERSION) || ENCRYPTION_KEY_VERSION < 1) {
    throw new HttpError(503, 'A criptografia da integração Meta ainda não foi configurada.');
  }
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, usages);
}

async function encryptToken(token: string) {
  const key = await encryptionKey(['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)
  );
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

async function decryptToken(secret: { ciphertext?: string; iv?: string; keyVersion?: number }) {
  if (Number(secret.keyVersion) !== ENCRYPTION_KEY_VERSION) {
    throw new HttpError(503, 'A credencial precisa ser substituída antes de continuar.');
  }
  try {
    const key = await encryptionKey(['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(String(secret.iv || '')) },
      key,
      fromBase64(String(secret.ciphertext || ''))
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'A credencial armazenada não pôde ser lida. Substitua-a para continuar.');
  }
}

function requiredId(body: Record<string, unknown>, field: string, label: string) {
  const value = String(body[field] || '').trim();
  if (!/^\d{5,40}$/.test(value)) throw new HttpError(400, `${label} inválido.`);
  return value;
}

function requiredUuid(body: Record<string, unknown>, field: string) {
  const value = String(body[field] || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'Conexão inválida.');
  }
  return value;
}

function requiredToken(body: Record<string, unknown>) {
  const token = String(body.accessToken || '').trim();
  if (token.length < 20 || token.length > 4096 || /[\s\x00-\x1f\x7f]/.test(token)) {
    throw new HttpError(400, 'Token permanente inválido.');
  }
  return token;
}

function metaMessage(status: number, code: number) {
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
    return 'A Meta limitou temporariamente as consultas. Aguarde alguns minutos e tente novamente.';
  }
  if (status >= 500) return 'A Meta está temporariamente indisponível. Tente novamente em alguns minutos.';
  if (status === 401 || status === 403 || code === 190 || code === 10 || code === 200) {
    return 'Não foi possível autorizar a conta. Confira o token permanente e as permissões de WhatsApp.';
  }
  return 'A Meta não validou estes dados. Confira o WABA ID, o Phone Number ID e as permissões do token.';
}

function metaUrl(pathOrUrl: string) {
  const base = `${META_GRAPH_ORIGIN}/${META_GRAPH_VERSION}/`;
  const url = new URL(pathOrUrl, base);
  if (url.origin !== META_GRAPH_ORIGIN || !url.pathname.startsWith(`/${META_GRAPH_VERSION}/`)) {
    throw new MetaError(502, 'A Meta retornou uma paginação inesperada. Tente sincronizar novamente.');
  }
  return url;
}

async function metaFetch(pathOrUrl: string, accessToken: string) {
  try {
    const response = await fetch(metaUrl(pathOrUrl), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const code = Number(body?.error?.code || 0);
      throw new MetaError(response.status >= 500 ? 503 : 400, metaMessage(response.status, code));
    }
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new MetaError(503, 'Não foi possível falar com a Meta agora. Verifique sua conexão e tente novamente.');
  }
}

async function paginatedMeta(path: string, accessToken: string, maxPages = 100) {
  const records: unknown[] = [];
  let next: string | null = path;
  for (let page = 0; next && page < maxPages; page += 1) {
    const body = await metaFetch(next, accessToken);
    if (!Array.isArray(body?.data)) throw new MetaError(502, 'A Meta retornou dados inesperados. Tente novamente.');
    records.push(...body.data);
    next = typeof body?.paging?.next === 'string' ? body.paging.next : null;
  }
  if (next) throw new MetaError(502, 'A conta possui dados demais para uma única sincronização. Contate o suporte.');
  return records;
}

function templateParameters(components: unknown[]) {
  const found = new Map<string, { component: string; name: string; kind: string }>();
  components.forEach(componentValue => {
    const component = componentValue as Record<string, unknown>;
    const componentType = String(component?.type || 'body').toLowerCase();
    const format = String(component?.format || '').toLowerCase();
    if (componentType === 'header' && ['image', 'video', 'document'].includes(format)) {
      found.set(`header:${format}`, { component: 'header', name: 'media', kind: format });
    }
    const serialized = JSON.stringify(componentValue);
    for (const match of serialized.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const name = match[1];
      found.set(`${componentType}:${name}`, { component: componentType, name, kind: 'text' });
    }
  });
  return [...found.values()];
}

function normalizeTemplates(records: unknown[]): ApprovedTemplate[] {
  return records.flatMap(value => {
    const template = value as Record<string, unknown>;
    const status = String(template.status || '').toLowerCase();
    const category = String(template.category || '').toLowerCase();
    const components = Array.isArray(template.components) ? template.components : [];
    if (
      status !== 'approved'
      || !['authentication', 'marketing', 'utility'].includes(category)
      || !template.id || !template.name || !template.language
    ) return [];
    const quality = template.quality_score;
    return [{
      id: String(template.id),
      name: String(template.name),
      language: String(template.language),
      category: category as ApprovedTemplate['category'],
      status: 'approved' as const,
      components,
      parameters: templateParameters(components),
      qualityScore: typeof quality === 'string'
        ? quality
        : String((quality as Record<string, unknown> | null)?.score || '')
    }];
  });
}

async function validateMetaAccount(wabaId: string, phoneNumberId: string, accessToken: string) {
  const [account, phoneNumbers] = await Promise.all([
    metaFetch(`${wabaId}?fields=id,name`, accessToken),
    paginatedMeta(
      `${wabaId}/phone_numbers?fields=id,verified_name,display_phone_number,quality_rating,code_verification_status&limit=100`,
      accessToken
    )
  ]);
  if (String(account?.id || '') !== wabaId) {
    throw new MetaError(400, 'O WABA ID informado não corresponde à conta autorizada.');
  }
  const phone = phoneNumbers.find(value => String((value as Record<string, unknown>)?.id || '') === phoneNumberId) as Record<string, unknown> | undefined;
  if (!phone) throw new MetaError(400, 'O Phone Number ID não pertence ao WABA informado.');
  return {
    accountName: String(account?.name || phone.verified_name || 'Conta do WhatsApp'),
    displayPhoneNumber: String(phone.display_phone_number || ''),
    phoneStatus: String(phone.code_verification_status || '')
  };
}

async function fetchApprovedTemplates(wabaId: string, accessToken: string) {
  const records = await paginatedMeta(
    `${wabaId}/message_templates?fields=id,name,language,category,status,components,quality_score&status=APPROVED&limit=100`,
    accessToken
  );
  return normalizeTemplates(records);
}

async function rpc(name: string, body: Record<string, unknown>) {
  return supabaseRequest(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
}

async function connectionFor(profile: Profile, connectionId: string): Promise<Connection> {
  const rows = await supabaseRequest(
    `/rest/v1/meta_connections?id=eq.${encodeURIComponent(connectionId)}&agency_id=eq.${encodeURIComponent(profile.agency_id)}&select=id,agency_id,whatsapp_business_account_id,phone_number_id&limit=1`
  );
  if (!rows?.[0]) throw new HttpError(404, 'Conexão do WhatsApp não encontrada.');
  return rows[0];
}

async function storedToken(profile: Profile, connectionId: string) {
  const secret = await rpc('get_meta_connection_secret', {
    p_connection_id: connectionId,
    p_agency_id: profile.agency_id,
    p_actor_id: profile.id
  });
  return decryptToken(secret || {});
}

async function markCheck(profile: Profile, connectionId: string, success: boolean) {
  await rpc('mark_meta_connection_check', {
    p_connection_id: connectionId,
    p_agency_id: profile.agency_id,
    p_actor_id: profile.id,
    p_success: success
  });
}

async function saveConnection(profile: Profile, body: Record<string, unknown>) {
  const wabaId = requiredId(body, 'whatsappBusinessAccountId', 'WABA ID');
  const phoneNumberId = requiredId(body, 'phoneNumberId', 'Phone Number ID');
  const accessToken = requiredToken(body);
  const connectionId = body.connectionId ? requiredUuid(body, 'connectionId') : crypto.randomUUID();

  const metaAccount = await validateMetaAccount(wabaId, phoneNumberId, accessToken);
  const templates = await fetchApprovedTemplates(wabaId, accessToken);
  const encrypted = await encryptToken(accessToken);
  const result = await rpc('store_validated_meta_connection', {
    p_connection_id: connectionId,
    p_agency_id: profile.agency_id,
    p_name: metaAccount.accountName.slice(0, 100),
    p_whatsapp_business_account_id: wabaId,
    p_phone_number_id: phoneNumberId,
    p_display_phone_number: metaAccount.displayPhoneNumber,
    p_token_ciphertext: encrypted.ciphertext,
    p_token_iv: encrypted.iv,
    p_key_version: ENCRYPTION_KEY_VERSION,
    p_actor_id: profile.id,
    p_templates: templates
  });
  return { ...result, credentialStored: true };
}

async function testConnection(profile: Profile, body: Record<string, unknown>) {
  const connectionId = requiredUuid(body, 'connectionId');
  const connection = await connectionFor(profile, connectionId);
  const accessToken = await storedToken(profile, connectionId);
  try {
    const account = await validateMetaAccount(
      connection.whatsapp_business_account_id,
      connection.phone_number_id,
      accessToken
    );
    await markCheck(profile, connectionId, true);
    return { connected: true, account, checkedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof MetaError) await markCheck(profile, connectionId, false).catch(() => {});
    throw error;
  }
}

async function synchronizeTemplates(profile: Profile, body: Record<string, unknown>) {
  const connectionId = requiredUuid(body, 'connectionId');
  const connection = await connectionFor(profile, connectionId);
  const accessToken = await storedToken(profile, connectionId);
  try {
    await validateMetaAccount(
      connection.whatsapp_business_account_id,
      connection.phone_number_id,
      accessToken
    );
    const templates = await fetchApprovedTemplates(connection.whatsapp_business_account_id, accessToken);
    const sync = await rpc('sync_approved_meta_templates', {
      p_connection_id: connectionId,
      p_agency_id: profile.agency_id,
      p_actor_id: profile.id,
      p_templates: templates
    });
    return { sync };
  } catch (error) {
    if (error instanceof MetaError) await markCheck(profile, connectionId, false).catch(() => {});
    throw error;
  }
}

async function queueCampaign(
  authorization: string,
  body: Record<string, unknown>,
  requestedAgencyId = ''
) {
  const campaignId = requiredUuid(body, 'campaignId');
  const queuedId = await supabaseRequest(
    '/rest/v1/rpc/queue_meta_campaign',
    {
      method: 'POST',
      headers: requestedAgencyId ? { 'X-Doti-Agency-Id': requestedAgencyId } : {},
      body: JSON.stringify({ p_campaign_id: campaignId })
    },
    authorization
  );
  return { campaignId: queuedId, status: 'queued' };
}

function delay(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function sendClaim(claim: CampaignClaim) {
  const startedAt = performance.now();
  let responseStatus = 0;
  let responseBody: Record<string, unknown> | null = null;
  let networkError = false;
  try {
    const accessToken = await decryptToken({
      ciphertext: claim.token_ciphertext,
      iv: claim.token_iv,
      keyVersion: claim.key_version
    });
    const components = buildTemplateComponents(claim.template_parameters, claim.template_variables);
    const response = await fetch(`${META_GRAPH_ORIGIN}/${META_GRAPH_VERSION}/${claim.phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: claim.phone_e164.replace(/^\+/, ''),
        type: 'template',
        biz_opaque_callback_data: claim.idempotency_key,
        template: {
          name: claim.template_name,
          language: { code: claim.template_language },
          ...(components.length ? { components } : {})
        }
      }),
      signal: AbortSignal.timeout(15000)
    });
    responseStatus = response.status;
    responseBody = await response.json().catch(() => null);
    const wamid = String((responseBody as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id || '');
    if (response.ok && wamid) {
      return rpc('record_meta_send_result', {
        p_recipient_id: claim.recipient_id,
        p_processing_token: claim.processing_token,
        p_success: true,
        p_transient: false,
        p_http_status: response.status,
        p_error_code: '',
        p_error_message: '',
        p_meta_message_id: wamid,
        p_response_metadata: {
          messagingProduct: responseBody?.messaging_product || 'whatsapp',
          latencyMs: Math.round(performance.now() - startedAt)
        }
      });
    }
  } catch (error) {
    if (error instanceof HttpError) {
      responseBody = { error: { code: 'CREDENTIAL_ERROR', message: error.message } };
    } else if (error instanceof Error && /Parâmetro obrigatório/.test(error.message)) {
      responseBody = { error: { code: 'INVALID_TEMPLATE_PARAMETERS', message: error.message } };
      responseStatus = 400;
    } else {
      networkError = true;
    }
  }

  const failure = classifyMetaFailure(responseStatus, responseBody, networkError);
  return rpc('record_meta_send_result', {
    p_recipient_id: claim.recipient_id,
    p_processing_token: claim.processing_token,
    p_success: false,
    p_transient: failure.transient,
    p_http_status: responseStatus || null,
    p_error_code: failure.code,
    p_error_message: failure.message,
    p_meta_message_id: '',
    p_response_metadata: safeMetaErrorMetadata(responseBody?.error, performance.now() - startedAt)
  });
}

async function processCampaign(campaignId: string) {
  for (let cycle = 0; cycle < 60; cycle += 1) {
    const claims = await rpc('claim_meta_campaign_batch', {
      p_campaign_id: campaignId,
      p_batch_size: 10
    }) as CampaignClaim[];
    if (claims.length) {
      const results = await Promise.allSettled(claims.map(claim => sendClaim(claim)));
      technicalLog('info', 'meta.campaign.batch', {
        campaignId,
        claimed: claims.length,
        rejected: results.filter(result => result.status === 'rejected').length
      });
      continue;
    }
    const progress = await rpc('finalize_meta_campaign', { p_campaign_id: campaignId });
    if (progress?.status === 'completed' || !progress?.nextAttemptAt) return;
    const wait = Math.max(100, Math.min(5500, new Date(progress.nextAttemptAt).getTime() - Date.now() + 100));
    await delay(wait);
  }
  technicalLog('error', 'meta.campaign.worker_limit', { campaignId, cycles: 60 });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, 405, { error: 'Método não permitido.' });
  if (!SUPABASE_URL || !PUBLIC_KEY || !ADMIN_KEY || !ENCRYPTION_KEY) {
    return json(request, 503, { error: 'A integração Meta ainda não foi configurada no servidor.' });
  }

  const startedAt = performance.now();
  let action = 'unknown';
  let agencyId = '';
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    action = String(body.action || '');
    const { profile, authorization, requestedAgencyId } = await managerContext(request);
    agencyId = profile.agency_id;
    await assertWhatsappRollout(profile);
    let result: unknown;
    let status = 200;
    if (action === 'connection.save') result = await saveConnection(profile, body);
    else if (action === 'connection.test') result = await testConnection(profile, body);
    else if (action === 'templates.sync') result = await synchronizeTemplates(profile, body);
    if (action === 'campaign.queue') {
      const queued = await queueCampaign(authorization, body, requestedAgencyId);
      EdgeRuntime.waitUntil(processCampaign(queued.campaignId).catch(error => {
        technicalLog('error', 'meta.campaign.worker_failed', {
          campaignId: queued.campaignId,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }));
      result = queued;
      status = 202;
    }
    if (result === undefined) throw new HttpError(400, 'Ação da integração Meta inválida.');
    technicalLog('info', 'meta.integration', {
      action, agencyId, outcome: 'success', durationMs: Math.round(performance.now() - startedAt)
    });
    return json(request, status, result);
  } catch (error) {
    technicalLog('error', 'meta.integration', {
      action,
      agencyId,
      outcome: 'failure',
      status: error instanceof HttpError ? error.status : 500,
      error: error instanceof Error ? error.message : 'unknown',
      durationMs: Math.round(performance.now() - startedAt)
    });
    if (error instanceof HttpError) return json(request, error.status, { error: error.message });
    return json(request, 500, { error: 'Não foi possível concluir a operação com a Meta.' });
  }
});
