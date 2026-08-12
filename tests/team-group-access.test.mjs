import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { normalizeGroupIds } from '../src/domains/team/team-domain.js';

const migration = readFileSync(
  new URL('../supabase/migrations/20260812143329_team_group_responsibilities.sql', import.meta.url),
  'utf8'
);
const teamFunction = readFileSync(new URL('../supabase/functions/team-admin/index.ts', import.meta.url), 'utf8');
const operationUi = readFileSync(new URL('../src/domains/operation/ui/operation-controller.js', import.meta.url), 'utf8');

test('normaliza grupos selecionados sem vazios ou duplicados', () => {
  assert.deepEqual(normalizeGroupIds(['grupo-a', '', ' grupo-b ', 'grupo-a', null]), ['grupo-a', 'grupo-b']);
  assert.deepEqual(normalizeGroupIds(null), []);
});

test('responsabilidades usam relações protegidas e são copiadas do convite para o perfil', () => {
  assert.match(migration, /create table public\.profile_group_responsibilities/i);
  assert.match(migration, /create table public\.invitation_group_responsibilities/i);
  assert.match(migration, /enable row level security/gi);
  assert.match(migration, /profiles_copy_invited_group_responsibilities/i);
  assert.match(migration, /grant execute on function public\.current_responsible_group_ids\(\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.replace_profile_group_responsibilities[\s\S]*from public, anon, authenticated/i);
});

test('convite, edição e filtro carregam os grupos atribuídos', () => {
  assert.match(teamFunction, /validatedGroupIds\(profile, role, body\.groupIds\)/);
  assert.match(teamFunction, /invitation_group_responsibilities/);
  assert.match(teamFunction, /replaceMemberGroups\(profile, memberId, groupIds\)/);
  assert.match(operationUi, /Todos os meus grupos/);
  assert.match(operationUi, /scopedDeliverables = state\.deliverables\.filter/);
});
