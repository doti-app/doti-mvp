import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  mergeGroupCatalog,
  normalizeGroupIds
} from '../src/domains/team/team-domain.js';

const migration = readFileSync(
  new URL('../supabase/migrations/20260812143329_team_group_responsibilities.sql', import.meta.url),
  'utf8'
);
const indexMigration = readFileSync(
  new URL('../supabase/migrations/20260813141845_index_team_group_responsibilities.sql', import.meta.url),
  'utf8'
);
const grantMigration = readFileSync(
  new URL('../supabase/migrations/20260813161824_grant_team_admin_group_read_access.sql', import.meta.url),
  'utf8'
);
const teamFunction = readFileSync(new URL('../supabase/functions/team-admin/index.ts', import.meta.url), 'utf8');
const operationUi = readFileSync(new URL('../src/domains/operation/ui/operation-controller.js', import.meta.url), 'utf8');

test('normaliza grupos selecionados sem vazios ou duplicados', () => {
  assert.deepEqual(normalizeGroupIds(['grupo-a', '', ' grupo-b ', 'grupo-a', null]), ['grupo-a', 'grupo-b']);
  assert.deepEqual(normalizeGroupIds(null), []);
});

test('mescla os grupos retornados pela equipe e pelo estado operacional', () => {
  assert.deepEqual(mergeGroupCatalog(
    [{ id: 'grupo-a', name: 'Atendimento' }],
    [
      { id: 'grupo-a', name: 'Atendimento duplicado' },
      { id: 'grupo-b', name: 'Design' },
      { id: '', name: 'Inválido' }
    ]
  ), [
    { id: 'grupo-a', name: 'Atendimento' },
    { id: 'grupo-b', name: 'Design' }
  ]);
});

test('responsabilidades usam relações protegidas e são copiadas do convite para o perfil', () => {
  assert.match(migration, /create table public\.profile_group_responsibilities/i);
  assert.match(migration, /create table public\.invitation_group_responsibilities/i);
  assert.match(migration, /enable row level security/gi);
  assert.match(migration, /profiles_copy_invited_group_responsibilities/i);
  assert.match(migration, /grant execute on function public\.current_responsible_group_ids\(\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.replace_profile_group_responsibilities[\s\S]*from public, anon, authenticated/i);
});

test('consultas de responsabilidades possuem índices compostos por agência', () => {
  assert.match(indexMigration, /profile_group_responsibilities \(agency_id, profile_id\)/i);
  assert.match(indexMigration, /invitation_group_responsibilities \(agency_id, invitation_id\)/i);
});

test('administração recebe somente leitura dos grupos via service role', () => {
  assert.match(grantMigration, /revoke insert, update, delete[\s\S]*agency_groups from service_role/i);
  assert.match(grantMigration, /grant select[\s\S]*agency_groups to service_role/i);
  assert.doesNotMatch(grantMigration, /grant[\s\S]*(insert|update|delete)[\s\S]*agency_groups to service_role/i);
});

test('convite, edição e filtro carregam os grupos atribuídos', () => {
  assert.match(teamFunction, /validatedGroupIds\(profile, role, body\.groupIds\)/);
  assert.match(teamFunction, /invitation_group_responsibilities/);
  assert.match(teamFunction, /replaceMemberGroups\(profile, memberId, groupIds\)/);
  assert.match(operationUi, /Todos os meus grupos/);
  assert.match(operationUi, /scopedDeliverables = state\.deliverables\.filter/);
});
