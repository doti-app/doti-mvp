import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReviewPatch,
  filterInteractions,
  generateIntegrationCredentials,
  normalizeInteraction,
  sha256,
  summarizeInteractions
} from '../dot-admin/chatbot-curation-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('normaliza e filtra conversas por status e conteúdo', () => {
  const rows = [
    normalizeInteraction({ id: '1', question: 'Como criar um site?', answer: 'Podemos ajudar.', status: 'pending', occurred_at: '2026-08-04T10:00:00Z' }),
    normalizeInteraction({ id: '2', question: 'Quero branding', answer: 'Vamos conversar.', status: 'approved', categories: ['marca'], occurred_at: '2026-08-04T11:00:00Z' })
  ];
  assert.equal(filterInteractions(rows, { status: 'pending' }).length, 1);
  assert.equal(filterInteractions(rows, { search: 'MARCA' })[0].id, '2');
  assert.equal(filterInteractions(rows, { search: 'site' })[0].id, '1');
});

test('resume fila e calcula tempo médio', () => {
  const summary = summarizeInteractions([
    { status: 'pending', response_time_ms: 2000 },
    { status: 'approved', response_time_ms: 4000 },
    { status: 'needs_review', response_time_ms: null }
  ]);
  assert.deepEqual(summary, { total: 3, pending: 1, approved: 1, needs_review: 1, rejected: 0, average_ms: 3000 });
});

test('monta atualização de curadoria vinculada ao revisor', () => {
  const now = new Date('2026-08-04T12:00:00Z');
  const reviewed = buildReviewPatch({ status: 'needs_review', rating: '3', categories: 'tom, escopo', notes: ' Ajustar. ' }, 'user-1', now);
  assert.equal(reviewed.reviewed_by, 'user-1');
  assert.equal(reviewed.reviewed_at, now.toISOString());
  assert.deepEqual(reviewed.categories, ['tom', 'escopo']);
  const pending = buildReviewPatch({ status: 'pending' }, 'user-1', now);
  assert.equal(pending.reviewed_by, null);
  assert.equal(pending.reviewed_at, null);
});

test('gera credenciais fortes sem guardar o segredo em texto aberto', async () => {
  const first = generateIntegrationCredentials();
  const second = generateIntegrationCredentials();
  assert.match(first.sourceKey, /^virgulinha_[a-f0-9]{16}$/);
  assert.match(first.secret, /^doti_wh_[a-f0-9]{48}$/);
  assert.notEqual(first.secret, second.secret);
  assert.match(await sha256(first.secret), /^[a-f0-9]{64}$/);
});

test('migração protege as tabelas e concede acesso explícito', () => {
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260804134156_chatbot_curation.sql'), 'utf8');
  assert.match(migration, /alter table public\.chatbot_integrations enable row level security/i);
  assert.match(migration, /alter table public\.chatbot_interactions enable row level security/i);
  assert.match(migration, /grant select .*chatbot_integrations to authenticated/is);
  assert.match(migration, /unique \(integration_id, external_event_id\)/i);
  assert.doesNotMatch(migration, /grant all .* to authenticated/i);
});
