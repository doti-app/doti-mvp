import { expect, test } from '@playwright/test';

async function mockLoginAuth(page, { signupData, resendError = null }) {
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
      window.__authCalls = { signUp: [], resend: [] };
      window.supabase = {
        createClient: () => ({
          auth: {
            getSession: async () => ({ data: { session: null } }),
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
            signOut: async () => ({ error: null })
          },
          rpc: async () => ({ data: null, error: null }),
          functions: { invoke: async () => ({ data: null, error: null }) }
        })
      };
    `
  }));
}

async function submitSignup(page, email = 'ana@agencia.test') {
  await page.goto('/dot-admin/');
  await page.locator('#secondaryAction').click();
  await page.locator('#fullName').fill('Ana da Silva');
  await page.locator('#agencyName').fill('Agência Aurora');
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill('senha-segura');
  await page.locator('#confirmPassword').fill('senha-segura');
  await page.locator('#loginForm').evaluate(form => form.requestSubmit());
}

test('novo cadastro pendente permite reenviar a confirmação', async ({ page }) => {
  await mockLoginAuth(page, {
    signupData: { session: null, user: { id: 'new-user', identities: [{ id: 'email-identity' }] } }
  });

  await submitSignup(page);

  await expect(page.locator('#loginStatus')).toContainText('Conta criada. Enviamos um link para confirmar seu e-mail.');
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

  await expect(page.locator('#loginTitle')).toContainText(/Bem-vindo\s*de volta/);
  await expect(page.locator('#loginEmail')).toHaveValue('existente@agencia.test');
  await expect(page.locator('#loginStatus')).toContainText('Este e-mail já possui uma conta');
  await expect(page.locator('#loginStatus')).not.toContainText('Conta criada');
  await expect(page.locator('#forgotPassword')).toBeVisible();
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
