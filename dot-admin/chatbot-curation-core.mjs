export const CURATION_STATUSES = ['pending', 'approved', 'needs_review', 'rejected'];

export function normalizeInteraction(row = {}) {
  const status = CURATION_STATUSES.includes(row.status) ? row.status : 'pending';
  const rawPayload = row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
  return {
    ...row,
    id: String(row.id || crypto.randomUUID()),
    question: String(row.question || '').trim(),
    answer: String(row.answer || '').trim(),
    channel: String(row.channel || 'web').trim() || 'web',
    external_user_id: String(row.external_user_id || rawPayload.user_id || rawPayload.id_usuario || '').trim(),
    external_session_id: String(
      row.external_session_id
      || rawPayload.session_id
      || rawPayload.id_atendimento
      || rawPayload.attendance_id
      || ''
    ).trim(),
    status,
    rating: row.rating == null ? null : Math.min(5, Math.max(1, Number(row.rating))),
    categories: Array.isArray(row.categories) ? row.categories.map(String).filter(Boolean).slice(0, 12) : [],
    review_notes: String(row.review_notes || ''),
    occurred_at: validDate(row.occurred_at) ? new Date(row.occurred_at).toISOString() : new Date().toISOString(),
    response_time_ms: row.response_time_ms != null && Number.isFinite(Number(row.response_time_ms))
      ? Math.max(0, Number(row.response_time_ms))
      : null
  };
}

export function filterInteractions(rows, { status = 'all', search = '' } = {}) {
  const needle = String(search).trim().toLocaleLowerCase('pt-BR');
  return rows.filter(row => {
    if (status !== 'all' && row.status !== status) return false;
    if (!needle) return true;
    return [row.question, row.answer, row.external_user_id, row.external_session_id, row.channel, ...(row.categories || [])]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(needle));
  });
}

export function groupInteractionsByDay(rows, timeZone = 'America/Sao_Paulo') {
  const groups = new Map();
  rows.forEach(row => {
    const date = validDate(row.occurred_at) ? new Date(row.occurred_at) : new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const key = `${values.year}-${values.month}-${values.day}`;
    if (!groups.has(key)) groups.set(key, { key, interactions: [], users: new Set(), sessions: new Set() });
    const group = groups.get(key);
    group.interactions.push(row);
    if (row.external_user_id) group.users.add(row.external_user_id);
    group.sessions.add(row.external_session_id || row.external_user_id || row.id);
  });
  return [...groups.values()]
    .sort((left, right) => right.key.localeCompare(left.key))
    .map(group => ({
      key: group.key,
      message_count: group.interactions.length,
      user_count: group.users.size,
      session_count: group.sessions.size,
      interactions: group.interactions.sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
    }));
}

export function summarizeInteractions(rows) {
  const result = { total: rows.length, pending: 0, approved: 0, needs_review: 0, rejected: 0, average_ms: null };
  let responseTotal = 0;
  let responseCount = 0;
  rows.forEach(row => {
    if (CURATION_STATUSES.includes(row.status)) result[row.status] += 1;
    if (row.response_time_ms != null && Number.isFinite(Number(row.response_time_ms))) {
      responseTotal += Number(row.response_time_ms);
      responseCount += 1;
    }
  });
  result.average_ms = responseCount ? Math.round(responseTotal / responseCount) : null;
  return result;
}

export function buildReviewPatch({ status, rating, categories, notes }, reviewerId, now = new Date()) {
  if (!CURATION_STATUSES.includes(status)) throw new Error('Status de curadoria inválido.');
  const pending = status === 'pending';
  return {
    status,
    rating: rating ? Math.min(5, Math.max(1, Number(rating))) : null,
    categories: String(categories || '').split(',').map(item => item.trim()).filter(Boolean).slice(0, 12),
    review_notes: String(notes || '').trim().slice(0, 5000) || null,
    reviewed_by: pending ? null : reviewerId,
    reviewed_at: pending ? null : now.toISOString()
  };
}

export function generateIntegrationCredentials() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return { sourceKey: `doti_bot_${token.slice(0, 16)}`, secret: `doti_wh_${token}` };
}

export function selectBotInteractions(rows, integrations, botId) {
  const integrationIds = new Set(
    integrations.filter(integration => integration.bot_id === botId).map(integration => integration.id)
  );
  return rows.filter(row => integrationIds.has(row.integration_id));
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validDate(value) {
  return value && !Number.isNaN(Date.parse(value));
}
