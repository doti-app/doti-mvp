import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReviewPatch,
  filterInteractions,
  generateIntegrationCredentials,
  groupInteractionsByDay,
  normalizeInteraction,
  selectBotInteractions,
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

test('agrupa o histórico do bot por dia, usuários e sessões', () => {
  const rows = [
    normalizeInteraction({ id: '1', occurred_at: '2026-08-04T13:00:00Z', question: 'A', answer: 'B', external_user_id: 'u1', external_session_id: 's1' }),
    normalizeInteraction({ id: '2', occurred_at: '2026-08-04T14:00:00Z', question: 'C', answer: 'D', external_user_id: 'u1', external_session_id: 's1' }),
    normalizeInteraction({ id: '3', occurred_at: '2026-08-04T15:00:00Z', question: 'E', answer: 'F', external_user_id: 'u2', external_session_id: 's2' }),
    normalizeInteraction({ id: '4', occurred_at: '2026-08-03T15:00:00Z', question: 'G', answer: 'H', external_user_id: 'u3', external_session_id: 's3' })
  ];
  const groups = groupInteractionsByDay(rows);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    { key: groups[0].key, messages: groups[0].message_count, users: groups[0].user_count, sessions: groups[0].session_count },
    { key: '2026-08-04', messages: 3, users: 2, sessions: 2 }
  );
  assert.equal(groups[0].interactions[0].id, '3');
});

test('separa conversas pela conexão do bot selecionado', () => {
  const integrations = [
    { id: 'integration-1', bot_id: 'bot-1' },
    { id: 'integration-2', bot_id: 'bot-2' },
    { id: 'integration-3', bot_id: 'bot-1' }
  ];
  const rows = [
    { id: 'chat-1', integration_id: 'integration-1' },
    { id: 'chat-2', integration_id: 'integration-2' },
    { id: 'chat-3', integration_id: 'integration-3' }
  ];
  assert.deepEqual(selectBotInteractions(rows, integrations, 'bot-1').map(row => row.id), ['chat-1', 'chat-3']);
  assert.deepEqual(selectBotInteractions(rows, integrations, 'missing'), []);
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
  assert.match(first.sourceKey, /^doti_bot_[a-f0-9]{16}$/);
  assert.match(first.secret, /^doti_wh_[a-f0-9]{48}$/);
  assert.notEqual(first.secret, second.secret);
  assert.match(await sha256(first.secret), /^[a-f0-9]{64}$/);
});

test('migração protege as tabelas e concede acesso explícito', () => {
  const curationMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260804134156_chatbot_curation.sql'), 'utf8');
  const botsMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260804134735_chatbot_control.sql'), 'utf8');
  const avatarMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260804172844_add_chatbot_avatar.sql'), 'utf8');
  const logsMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260804141434_chatbot_conversation_logs.sql'), 'utf8');
  assert.match(curationMigration, /alter table public\.chatbot_integrations enable row level security/i);
  assert.match(curationMigration, /alter table public\.chatbot_interactions enable row level security/i);
  assert.match(curationMigration, /unique \(integration_id, external_event_id\)/i);
  assert.match(botsMigration, /create table public\.chatbots/i);
  assert.match(botsMigration, /alter table public\.chatbots enable row level security/i);
  assert.match(botsMigration, /foreign key \(agency_id, bot_id\)/i);
  assert.match(botsMigration, /grant select \(bot_id\) on public\.chatbot_integrations to authenticated/i);
  assert.match(botsMigration, /grant insert \(bot_id\) on public\.chatbot_integrations to authenticated/i);
  assert.match(avatarMigration, /add column avatar_path text/i);
  assert.match(avatarMigration, /grant select \(avatar_path\) on public\.chatbots to authenticated/i);
  assert.match(avatarMigration, /grant update \(avatar_path\) on public\.chatbots to authenticated/i);
  assert.match(logsMigration, /add column external_session_id text/i);
  assert.match(logsMigration, /chatbot_interactions_agency_session_idx/i);
  assert.doesNotMatch(logsMigration, /grant\s/i);
  assert.doesNotMatch(`${curationMigration}\n${botsMigration}`, /grant all .* to authenticated/i);
});

test('controle permite desativar e remover bots com proteção da ingestão', () => {
  const interfaceCode = fs.readFileSync(path.join(root, 'dot-admin/chatbot-curation.js'), 'utf8');
  const ingestCode = fs.readFileSync(path.join(root, 'supabase/functions/chatbot-ingest/index.ts'), 'utf8');
  assert.match(interfaceCode, /\.from\('chatbots'\)\s*\.update\(\{ is_active: nextActive \}\)/);
  assert.match(interfaceCode, /\.from\('chatbots'\)\.delete\(\)\.eq\('id', bot\.id\)/);
  assert.match(interfaceCode, /Esta ação não pode ser desfeita/);
  assert.match(ingestCode, /\.from\("chatbots"\)[\s\S]*\.select\("is_active"\)/);
  assert.match(ingestCode, /!bot\?\.is_active/);
});

test('novo bot aceita paleta de cores e imagem privada', () => {
  const interfaceCode = fs.readFileSync(path.join(root, 'dot-admin/chatbot-curation.js'), 'utf8');
  assert.match(interfaceCode, /const BOT_COLORS = \[/);
  assert.match(interfaceCode, /name="avatar" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(interfaceCode, /uploadOperationFile\(bot\.id, avatarFile\)/);
  assert.match(interfaceCode, /downloadOperationFile\(image\.dataset\.botAvatar, bot\?\.avatar_path\)/);
  assert.match(interfaceCode, /avatarFile\.size > 10 \* 1024 \* 1024/);
});
