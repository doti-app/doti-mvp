import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getValidSession,
  isSessionExpired,
  SESSION_MAX_AGE_MS,
  sessionSignInDate
} from '../src/shared/auth/session-policy.js';

function sessionAt(date) {
  return {
    access_token: 'token',
    user: { last_sign_in_at: date.toISOString() }
  };
}

test('a sessão continua válida antes de completar quatro horas', () => {
  const signedInAt = new Date(2026, 7, 19, 8, 30);
  const session = sessionAt(signedInAt);
  assert.equal(SESSION_MAX_AGE_MS, 4 * 60 * 60 * 1000);
  assert.equal(isSessionExpired(session, new Date(signedInAt.getTime() + SESSION_MAX_AGE_MS - 1)), false);
});

test('a sessão expira ao completar quatro horas mesmo no mesmo dia', () => {
  const signedInAt = new Date(2026, 7, 19, 8, 30);
  const session = sessionAt(signedInAt);
  assert.equal(isSessionExpired(session, new Date(signedInAt.getTime() + SESSION_MAX_AGE_MS)), true);
});

test('sessão sem data de login verificável expira de forma segura', () => {
  assert.equal(sessionSignInDate({ access_token: 'invalid' }), null);
  assert.equal(isSessionExpired({ access_token: 'invalid', user: {} }), true);
});

test('sessão expirada é encerrada somente neste dispositivo', async () => {
  const calls = [];
  const supabase = {
    auth: {
      getSession: async () => ({
        data: { session: sessionAt(new Date(2026, 7, 18, 12)) },
        error: null
      }),
      signOut: async options => {
        calls.push(options);
        return { error: null };
      }
    }
  };

  const result = await getValidSession(supabase, new Date(2026, 7, 19, 9));
  assert.deepEqual(result, { session: null, error: null, expired: true });
  assert.deepEqual(calls, [{ scope: 'local' }]);
});
