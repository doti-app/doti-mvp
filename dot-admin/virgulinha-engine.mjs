const ACTION_WORDS = /\b(criar|crie|cadastre|cadastrar|adicionar|adicione|novo|nova|quero|preciso|monte|montar|gere|gerar)\b/;

export function normalizeCommandText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAction(text) {
  return ACTION_WORDS.test(text) || /^(demanda|projeto|fluxo)\b/.test(text);
}

function cleanCapturedValue(value) {
  return String(value || '')
    .replace(/^[\s:,-]+|[\s,;.]+$/g, '')
    .replace(/^(?:chamad[oa]|com o nome de|de nome)\s+/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function matchCatalogItems(text, items) {
  const normalized = normalizeCommandText(text);
  return [...(items || [])]
    .sort((a, b) => String(b.name).length - String(a.name).length)
    .filter(item => normalized.includes(normalizeCommandText(item.name)))
    .map(item => item.id);
}

function parseDate(text, now = new Date()) {
  const normalized = normalizeCommandText(text);
  const relative = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/\bamanha\b/.test(normalized)) relative.setDate(relative.getDate() + 1);
  else if (/\bhoje\b/.test(normalized)) {}
  else if (/\b(proxima semana|semana que vem)\b/.test(normalized)) relative.setDate(relative.getDate() + 7);
  else if (/\b(daqui a|em)\s+\d+\s+dias?\b/.test(normalized)) {
    const days = Number(normalized.match(/\b(?:daqui a|em)\s+(\d+)\s+dias?\b/)?.[1] || 0);
    relative.setDate(relative.getDate() + days);
  }
  else {
    const iso = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
    const local = normalized.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/);
    if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (!local) return '';
    let year = local[3] ? Number(local[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    return validIsoDate(year, Number(local[2]), Number(local[1]));
  }
  return toIsoDate(relative);
}

function validIsoDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return toIsoDate(date);
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function captureBetween(text, start, stops) {
  const stopPattern = stops.map(item => `(?=${item})`).join('|');
  const match = text.match(new RegExp(`${start}\\s+(.+?)(?:${stopPattern}|$)`, 'i'));
  return cleanCapturedValue(match?.[1]);
}

function parseProjectName(text) {
  return captureBetween(
    text,
    '(?:demanda|projeto)(?:\\s+(?:chamad[oa]|com o nome de|de nome))?',
    ['\\s+(?:para|pro|pra|do cliente|da cliente|cliente)\\b', '\\s+(?:com|usando)\\s+(?:o\\s+)?fluxo\\b', '\\s+(?:com\\s+)?prazo\\b', '\\s+at[eé]\\b']
  );
}

function parseWorkflowFields(text) {
  const normalized = normalizeCommandText(text);
  const stepsMarker = normalized.match(/\b(?:com\s+as\s+|com\s+|as\s+)?etapas?\s*[:=-]?\s*/);
  let steps = [];
  if (stepsMarker) {
    const raw = text.slice(stepsMarker.index + stepsMarker[0].length);
    steps = raw
      .split(/\s*(?:>|→|->|;|\n|,)\s*/)
      .map(cleanCapturedValue)
      .filter(Boolean);
  }
  const name = captureBetween(
    text,
    'fluxo(?:\\s+(?:chamado|com o nome de|de nome))?',
    ['\\s+(?:da\\s+)?categoria\\b', '\\s+(?:com\\s+as\\s+|com\\s+|as\\s+)?etapas?\\b', '\\s+para\\b']
  );
  const category = captureBetween(
    text,
    '(?:da\\s+)?categoria',
    ['\\s+(?:com\\s+as\\s+|com\\s+|as\\s+)?etapas?\\b']
  );
  return { name, category, steps };
}

export function analyzeVirgulinhaCommand(command, context = {}) {
  const raw = String(command || '').trim();
  const text = normalizeCommandText(raw);
  if (!text) return { intent: 'empty', confidence: 0, fields: {} };

  const wantsProject = /\b(demanda|projeto)\b/.test(text) && includesAction(text);
  const wantsWorkflow = /\bfluxo\b/.test(text) && includesAction(text);

  if (wantsProject) {
    return {
      intent: 'create_project',
      confidence: 1,
      fields: {
        name: parseProjectName(raw),
        due: parseDate(raw, context.now),
        clientId: matchCatalogItems(raw, context.clients)[0] || '',
        workflowIds: matchCatalogItems(raw, context.workflows)
      }
    };
  }

  if (wantsWorkflow) {
    return { intent: 'create_workflow', confidence: 1, fields: parseWorkflowFields(raw) };
  }

  return { intent: 'unknown', confidence: 0, fields: {} };
}
