import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampaignResultsCsv,
  normalizePhone,
  parseCsv,
  prepareCsvRecipients,
  preparePastedRecipients,
  renderTemplatePreview
} from './whatsapp-campaign-utils.mjs';

test('normaliza números brasileiros e preserva internacionais completos', () => {
  assert.equal(normalizePhone('(11) 99999-9999'), '+5511999999999');
  assert.equal(normalizePhone('5511999999999'), '+5511999999999');
  assert.equal(normalizePhone('+1 (415) 555-2671'), '+14155552671');
  assert.equal(normalizePhone('0014155552671'), '+14155552671');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('(10) 99999-9999'), null);
  assert.equal(normalizePhone('(11) 19999-9999'), null);
});

test('interpreta CSV com delimitador, aspas e cabeçalhos', () => {
  const parsed = parseCsv('telefone;nome;cidade\r\n"(11) 99999-9999";"Ana; Maria";Sorocaba');
  assert.deepEqual(parsed.headers, ['telefone', 'nome', 'cidade']);
  assert.equal(parsed.rows[0].values.nome, 'Ana; Maria');
  assert.equal(parsed.rows[0].line, 2);
});

test('CSV rejeita cabeçalhos duplicados e conteúdo sem dados', () => {
  assert.throws(() => parseCsv('nome;NOME\nAna;Bia'), /aparece mais de uma vez/);
  assert.throws(() => parseCsv('telefone'), /cabeçalho/);
});

test('CSV aceita 100 destinatários e rejeita qualquer linha adicional', () => {
  const csv = count => ['telefone,nome', ...Array.from(
    { length: count },
    (_, index) => `+1415555${String(index).padStart(4, '0')},Contato ${index + 1}`
  )].join('\n');
  assert.equal(parseCsv(csv(100)).rows.length, 100);
  assert.throws(() => parseCsv(csv(101)), /no máximo 100 linhas/);
});

test('mapeamento rejeita colunas ausentes antes de preparar destinatários', () => {
  const parsed = parseCsv('telefone,nome\n+14155552671,Ana');
  assert.throws(() => prepareCsvRecipients(parsed, 'celular', { nome: 'nome' }), /coluna de telefone existente/);
  assert.throws(() => prepareCsvRecipients(parsed, 'telefone', { codigo: 'codigo' }), /não possui as colunas/);
});

test('deduplica contatos e identifica inválidos e linhas incompletas', () => {
  const parsed = parseCsv([
    'telefone,nome',
    '(11) 99999-9999,Ana',
    '5511999999999,Ana duplicada',
    'invalido,Bia',
    '+14155552671,'
  ].join('\n'));
  const result = prepareCsvRecipients(parsed, 'telefone', { '1': 'nome' });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected[1].reason, /Linha incompleta/);
});

test('colagem simples deduplica depois da normalização', () => {
  const result = preparePastedRecipients('(11) 99999-9999\n5511999999999\n+14155552671\nabc');
  assert.deepEqual(result.accepted.map(item => item.phone), ['+5511999999999', '+14155552671']);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.rejected.length, 1);
});

test('prévia substitui parâmetros pelos dados do destinatário', () => {
  const template = { components: [{ type: 'BODY', text: 'Olá {{1}}, sua data é {{data}}.' }] };
  assert.equal(renderTemplatePreview(template, { '1': 'Ana', data: '10/08' }), 'Olá Ana, sua data é 10/08.');
});

test('exporta resultados em CSV com rótulos, BOM e caracteres especiais escapados', () => {
  const csv = buildCampaignResultsCsv([{
    phone_e164: '+5511999999999',
    status: 'failed',
    attempt_count: 3,
    meta_message_id: 'wamid.1',
    error_code: '131000',
    error_message: 'Falha; nome "inválido"\nem duas linhas',
    accepted_at: null,
    failed_at: '2026-08-01T19:00:00Z'
  }], { failed: 'Falhou' });

  assert.ok(csv.startsWith('\uFEFFtelefone;status;tentativas;'));
  assert.match(csv, /\+5511999999999;Falhou;3;wamid\.1;131000;/);
  assert.match(csv, /"Falha; nome ""inválido""\nem duas linhas"/);
  assert.match(csv, /2026-08-01T19:00:00Z$/);
});
