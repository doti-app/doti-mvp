export const CURATION_STATUSES = ['pending', 'approved', 'needs_review', 'rejected'];

export function normalizeInteraction(row = {}) {
  const status = CURATION_STATUSES.includes(row.status) ? row.status : 'pending';
  return {
    ...row,
    id: String(row.id || crypto.randomUUID()),
    question: String(row.question || '').trim(),
    answer: String(row.answer || '').trim(),
    channel: String(row.channel || 'web').trim() || 'web',
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
    return [row.question, row.answer, row.external_user_id, row.channel, ...(row.categories || [])]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(needle));
  });
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
  return { sourceKey: `virgulinha_${token.slice(0, 16)}`, secret: `doti_wh_${token}` };
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validDate(value) {
  return value && !Number.isNaN(Date.parse(value));
}
