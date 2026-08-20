import { expect, test } from '@playwright/test';

async function mockLoginAuth(page, { signupData = null, resendError = null, existingSession = null }) {
  await page.route('**/api/auth-config', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      configured: true,
      localMode: false,
      supabaseUrl: 'https://mock.supabase.co',
      supabasePublishableKey: 'mock'
    })
  }));
  await page.route('**/assets/vendor/supabase-2.57.4.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.__authCalls = { signUp: [], resend: [], signOut: [] };
      window.supabase = {
        createClient: () => ({
          auth: {
            getSession: async () => ({ data: { session: ${JSON.stringify(existingSession)} } }),
            signUp: async options => {
              window.__authCalls.signUp.push(options);
              return { data: ${JSON.stringify(signupData)}, error: null };
            },
            resend: async options => {
              window.__authCalls.resend.push(options);
              return { data: null, error: ${JSON.stringify(resendError)} };
            },
            signInWithPassword: async () => ({ error: null }),
            resetPasswordForEmail: async () => ({ error: null }),
            updateUser: async () => ({ error: null }),
            signOut: async options => {
              window.__authCalls.signOut.push(options);
              return { error: null };
            }
          },
          rpc: async () => ({ data: null, error: null }),
          functions: { invoke: async () => ({ data: null, error: null }) }
        })
      };
    `
  }));
}

test('sessão com mais de quatro horas volta para o login', async ({ page }) => {
  await mockLoginAuth(page, {
    existingSession: {
      access_token: 'mock-token',
      user: {
        id: 'old-user',
        last_sign_in_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
      }
    }
  });

  await page.goto('/dot-admin/');

  await expect(page.locator('#loginStatus')).toContainText('Sua sessão expirou. Entre novamente para continuar.');
  await expect.poll(() => page.evaluate(() => window.__authCalls.signOut)).toEqual([{ scope: 'local' }]);
});

async function submitSignup(page, email = 'ana@agencia.test') {
  const password = 'senha-segura';
  await page.goto('/dot-admin/');
  await expect(page.locator('#secondaryAction')).toBeEnabled();
  await expect(page.locator('#loginIllustration')).toHaveAttribute('src', '/assets/login-illustration.png');
  await page.locator('#secondaryAction').click();
  await expect(page.locator('#loginIllustration')).toHaveAttribute('src', '/assets/login-signup-illustration.png');
  await expect(page.locator('#fullName')).toBeVisible();
  await expect(page.locator('#agencyName')).toBeVisible();
  await page.locator('#fullName').fill('Ana da Silva');
  await expect(page.locator('#fullName')).toHaveValue('Ana da Silva');
  await page.locator('#agencyName').fill('Agência Aurora');
  await expect(page.locator('#agencyName')).toHaveValue('Agência Aurora');
  await page.locator('#loginEmail').fill(email);
  await expect(page.locator('#loginEmail')).toHaveValue(email);
  await page.locator('#loginPassword').fill(password);
  await expect(page.locator('#loginPassword')).toHaveValue(password);
  await page.locator('#confirmPassword').fill(password);
  await expect(page.locator('#confirmPassword')).toHaveValue(password);
  await page.locator('#loginForm button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => window.__authCalls.signUp.length)).toBe(1);
}

test('novo cadastro pendente permite reenviar a confirmação', async ({ page }) => {
  await mockLoginAuth(page, {
    signupData: { session: null, user: { id: 'new-user', identities: [{ id: 'email-identity' }] } }
  });

  await submitSignup(page);

  await expect(page.locator('#loginStatus')).toContainText('Enviamos um link para confirmar este e-mail.');
  await expect(page.locator('#loginEmail')).toHaveValue('ana@agencia.test');
  await expect(page.locator('#resendConfirmation')).toBeVisible();

  await page.locator('#resendConfirmation').click();

  await expect(page.locator('#loginStatus')).toContainText('Novo e-mail de confirmação enviado');
  await expect.poll(() => page.evaluate(() => window.__authCalls.resend)).toEqual([{
    type: 'signup',
    email: 'ana@agencia.test',
    options: { emailRedirectTo: 'http://127.0.0.1:3000/dot-admin/?confirmed=1' }
  }]);
});

test('tentativa repetida mostra a conta existente e não informa sucesso de cadastro', async ({ page }) => {
  await mockLoginAuth(page, {
    signupData: { session: null, user: { id: 'existing-user', identities: [] } }
  });

  await submitSignup(page, 'existente@agencia.test');

  await expect(page.locator('#loginTitle')).toContainText('Seja bem-vindo!');
  await expect(page.locator('#loginEmail')).toHaveValue('existente@agencia.test');
  await expect(page.locator('#loginStatus')).toContainText('Este e-mail já possui uma conta');
  await expect(page.locator('#loginStatus')).not.toContainText('Conta criada');
  await expect(page.locator('#forgotPassword')).toBeVisible();
  await expect(page.locator('#resendConfirmation')).toBeVisible();
});

test('conta pendente existente não é apresentada como conta recém-criada', async ({ page }) => {
  await mockLoginAuth(page, {
    signupData: { session: null, user: { id: 'pending-user', identities: [{ id: 'email-identity' }] } }
  });

  await submitSignup(page, 'pendente@agencia.test');

  await expect(page.locator('#loginTitle')).toContainText('Seja bem-vindo!');
  await expect(page.locator('#loginEmail')).toHaveValue('pendente@agencia.test');
  await expect(page.locator('#loginStatus')).toContainText('Se já havia um cadastro pendente');
  await expect(page.locator('#loginStatus')).not.toContainText('Conta criada');
  await expect(page.locator('#resendConfirmation')).toBeVisible();
});

test('limite do Supabase ao reenviar confirmação recebe uma mensagem amigável', async ({ page }) => {
  await mockLoginAuth(page, {
    signupData: { session: null, user: { id: 'new-user', identities: [{ id: 'email-identity' }] } },
    resendError: { message: 'Email rate limit exceeded' }
  });

  await submitSignup(page);
  await page.locator('#resendConfirmation').click();

  await expect(page.locator('#loginStatus')).toContainText('Aguarde alguns minutos antes de pedir outro e-mail de confirmação.');
});
