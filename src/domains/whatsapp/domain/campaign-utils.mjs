const BRAZIL_AREA_CODES = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99'
]);

function normalizeBrazilianDigits(value) {
  const national = value.startsWith('55') ? value.slice(2) : value;
  if (!/^\d{10,11}$/.test(national) || !BRAZIL_AREA_CODES.has(national.slice(0, 2))) return null;
  const subscriber = national.slice(2);
  const validSubscriber = subscriber.length === 9
    ? /^9\d{8}$/.test(subscriber)
    : /^[2-5]\d{7}$/.test(subscriber);
  return validSubscriber ? `+55${national}` : null;
}

export function normalizePhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const explicitlyInternational = raw.startsWith('+') || raw.startsWith('00');
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);

  if (explicitlyInternational) {
    if (digits.startsWith('55')) return normalizeBrazilianDigits(digits);
    return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
  }

  return normalizeBrazilianDigits(digits);
}

export function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const candidates = [',', ';', '\t'];
  const delimiter = candidates.reduce((best, candidate) => {
    const occurrences = firstLine.split(candidate).length - 1;
    return occurrences > best.occurrences ? { value: candidate, occurrences } : best;
  }, { value: ',', occurrences: -1 }).value;
  const matrix = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) matrix.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('O CSV possui aspas sem fechamento.');
  row.push(cell.trim());
  if (row.some(value => value !== '')) matrix.push(row);
  if (matrix.length < 2) throw new Error('O CSV precisa ter cabeçalho e ao menos uma linha de dados.');
  if (matrix.length - 1 > 100) {
    throw new Error('O CSV pode ter no máximo 100 linhas de destinatários. Divida o arquivo e tente novamente.');
  }

  const headers = matrix[0].map((header, index) => header || `coluna_${index + 1}`);
  const seen = new Set();
  headers.forEach(header => {
    const key = header.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) throw new Error(`A coluna “${header}” aparece mais de uma vez.`);
    seen.add(key);
  });
  const rows = matrix.slice(1).map((values, index) => ({
    line: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, values[column] || '']))
  }));
  return { headers, rows, delimiter };
}

export function requiredTemplateParams(template) {
  const unique = new Map();
  (Array.isArray(template?.parameters) ? template.parameters : []).forEach(parameter => {
    const name = String(parameter?.name || '').trim();
    if (name) unique.set(name, { ...parameter, name });
  });
  return [...unique.values()];
}

export function templateBody(template) {
  const component = (Array.isArray(template?.components) ? template.components : [])
    .find(item => String(item?.type || '').toLowerCase() === 'body');
  return String(component?.text || 'Template sem texto de prévia.');
}

export function renderTemplatePreview(template, variables = {}) {
  return templateBody(template).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name) => {
    const value = String(variables[String(name).trim()] ?? '').trim();
    return value || `{{${String(name).trim()}}}`;
  });
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",;\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildCampaignResultsCsv(recipients, statusLabels = {}) {
  const header = ['telefone', 'status', 'tentativas', 'wamid', 'codigo_erro', 'motivo_erro', 'aceito_em', 'enviado_em', 'entregue_em', 'lido_em', 'falhou_em'];
  const lines = (Array.isArray(recipients) ? recipients : []).map(recipient => [
    recipient.phone_e164,
    statusLabels[recipient.status] || recipient.status,
    recipient.attempt_count,
    recipient.meta_message_id,
    recipient.error_code,
    recipient.error_message,
    recipient.accepted_at,
    recipient.sent_at,
    recipient.delivered_at,
    recipient.read_at,
    recipient.failed_at
  ].map(csvCell).join(';'));
  return `\uFEFF${header.join(';')}\r\n${lines.join('\r\n')}`;
}

export function prepareCsvRecipients(parsed, phoneColumn, mappings) {
  const accepted = [];
  const rejected = [];
  const duplicates = [];
  const seenPhones = new Set();
  const entries = Object.entries(mappings || {});

  if (!Array.isArray(parsed?.headers) || !parsed.headers.includes(phoneColumn)) {
    throw new Error('Selecione uma coluna de telefone existente no CSV.');
  }
  const missingColumns = entries
    .map(([, column]) => column)
    .filter(column => !parsed.headers.includes(column));
  if (missingColumns.length) {
    throw new Error(`O CSV não possui as colunas mapeadas: ${[...new Set(missingColumns)].join(', ')}.`);
  }

  parsed.rows.forEach(row => {
    const phone = normalizePhone(row.values[phoneColumn]);
    if (!phone) {
      rejected.push({ line: row.line, reason: 'Número ausente ou inválido' });
      return;
    }
    const variables = {};
    const missing = [];
    entries.forEach(([parameter, column]) => {
      const value = String(row.values[column] || '').trim();
      variables[parameter] = value;
      if (!value) missing.push(parameter);
    });
    if (missing.length) {
      rejected.push({ line: row.line, phone, reason: `Linha incompleta: ${missing.join(', ')}` });
      return;
    }
    if (seenPhones.has(phone)) {
      duplicates.push({ line: row.line, phone });
      return;
    }
    seenPhones.add(phone);
    accepted.push({ phone, variables, line: row.line });
  });
  return { accepted, rejected, duplicates };
}

export function preparePastedRecipients(text) {
  const accepted = [];
  const rejected = [];
  const duplicates = [];
  const seenPhones = new Set();
  String(text || '').split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const phone = normalizePhone(raw);
    if (!phone) {
      rejected.push({ line: index + 1, reason: 'Número inválido' });
      return;
    }
    if (seenPhones.has(phone)) {
      duplicates.push({ line: index + 1, phone });
      return;
    }
    seenPhones.add(phone);
    accepted.push({ phone, variables: {}, line: index + 1 });
  });
  return { accepted, rejected, duplicates };
}
