import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('platform overview service role remains read-only', () => {
  const migrationName = fs.readdirSync(path.join(root, 'supabase/migrations'))
    .find(name => name.endsWith('_grant_platform_overview_read_access.sql'));
  assert.ok(migrationName, 'platform overview grant migration must exist');
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations', migrationName),
    'utf8'
  );

  assert.match(migration, /grant select on table[\s\S]*public\.projects,[\s\S]*public\.deliverables,[\s\S]*public\.activity_events[\s\S]*to service_role;/i);
  assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete|all)/i);
});

test('platform operational failures do not redirect an authenticated user', () => {
  const entry = fs.readFileSync(path.join(root, 'src/app/platform-entry.js'), 'utf8');

  assert.match(entry, /try \{ await loadOverview\(\); \}\s*catch \(error\) \{ console\.error\(error\); toast\('Não foi possível carregar o portal DOT', error\.message\); \}/);
  assert.match(entry, /location\.replace\('\/dot-admin\/\?reason=unauthorized'\)/);
});

test('DOTI staff can return from their personal agency to the internal portal', () => {
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const session = fs.readFileSync(path.join(root, 'src/shared/auth/session.js'), 'utf8');

  assert.match(page, /id="dotiPortalReturn" href="\/doti\/"[^>]*hidden/);
  assert.match(session, /button\.hidden = !platformStaff\?\.isActive \|\| supportMode;/);
  assert.match(session, /configurePlatformReturn\(platformStaff, supportMode\);/);
});
