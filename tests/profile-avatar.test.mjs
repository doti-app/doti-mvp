import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  PROFILE_AVATAR_BUCKET,
  createStoredAvatarReference,
  resolveAvatarImageUrl,
  storedAvatarPath,
  validAvatar
} from '../src/shared/profile-avatar.js';

const userId = '123e4567-e89b-42d3-a456-426614174000';

test('creates and resolves a temporary URL for a stored avatar reference', async () => {
  const reference = createStoredAvatarReference(userId, 1724000000000);
  const supabase = {
    storage: {
      from(bucket) {
        assert.equal(bucket, PROFILE_AVATAR_BUCKET);
        return {
          createSignedUrl(filePath, expiresIn) {
            assert.equal(filePath, `${userId}/avatar.jpg`);
            assert.equal(expiresIn, 3600);
            return { data: { signedUrl: `https://example.supabase.co/${filePath}?token=signed` }, error: null };
          }
        };
      }
    }
  };

  assert.equal(reference, `profile-avatar:${userId}:1724000000000`);
  assert.equal(storedAvatarPath(reference), `${userId}/avatar.jpg`);
  assert.equal(
    await resolveAvatarImageUrl(reference, supabase),
    `https://example.supabase.co/${userId}/avatar.jpg?token=signed`
  );
});

test('rejects forged and unsafe avatar values', () => {
  assert.equal(validAvatar('javascript:alert(1)'), '');
  assert.equal(validAvatar('profile-avatar:not-a-user:123'), '');
  assert.equal(validAvatar('/assets/avatars-users/avatar-31.png'), '');
});

test('profile avatar migration restricts writes to the authenticated user path', () => {
  const root = process.cwd();
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260819141444_profile_avatar_upload.sql'),
    'utf8'
  );
  assert.match(migration, /'doti-avatars'[\s\S]*false[\s\S]*array\['image\/jpeg'\]/i);
  assert.match(migration, /for insert to authenticated[\s\S]*name = \(select auth\.uid\(\)\)::text \|\| '\/avatar\.jpg'/i);
  assert.match(migration, /for update to authenticated[\s\S]*with check/i);
  assert.match(migration, /join public\.profiles avatar_owner[\s\S]*avatar_owner\.agency_id = viewer\.agency_id/i);
  assert.match(migration, /profile-avatar:/i);
});
