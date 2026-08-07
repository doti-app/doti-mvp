import { expect, test } from '@playwright/test';

test('carrega o painel local e navega pelas áreas principais', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/');

  await expect(page.locator('.local-mode-banner')).toContainText('Modo local seguro');
  await expect(page.locator('#dashboardHeadline')).toBeVisible();

  for (const pageId of ['demandas', 'fluxos', 'clientes', 'curadoria-chatbot', 'equipe', 'whatsapp']) {
    await page.locator(`[data-page="${pageId}"]`).click();
    await expect(page.locator(`#${pageId}`)).toHaveClass(/active/);
  }

  await page.locator('#profileSettingsEntry').click();
  await expect(page.locator('#meus-dados')).toHaveClass(/active/);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('a rota de login retorna ao painel no modo local', async ({ page }) => {
  await page.goto('/dot-admin/');
  await expect(page).toHaveURL(/\/(?:index\.html)?$/);
  await expect(page.locator('.local-mode-banner')).toBeVisible();
});

test('o portal interno não contorna a autenticação no modo local', async ({ page }) => {
  await page.goto('/doti/');
  await expect(page).toHaveURL(/\/(?:index\.html)?$/);
  await expect(page.locator('.local-mode-banner')).toContainText('Modo local seguro');
});

test('renderiza o portal DOT autenticado com visão macro e diretórios', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/auth-config', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ configured: true, localMode: false, supabaseUrl: 'https://mock.supabase.co', supabasePublishableKey: 'mock' })
  }));
  await page.route('**/assets/vendor/supabase-2.57.4.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      const overview = {
        currentStaff: { id: 'staff-1', role: 'admin' },
        summary: { agencyCount: 2, activeAgencyCount: 2, archivedAgencyCount: 0, userCount: 8, activeUserCount: 7, projectCount: 11, overdueCount: 2, activeBotCount: 3 },
        agencies: [
          { id: '27000000-0000-4000-8000-000000000001', name: 'Agência Aurora', status: 'active', ownerName: 'Ana Lima', ownerEmail: 'ana@aurora.test', memberCount: 5, activeMemberCount: 5, projectCount: 8, deliverableCount: 12, overdueCount: 2, botCount: 3, activeBotCount: 2, whatsappStage: 'general', whatsappEnabled: true, lastActivityAt: new Date().toISOString() },
          { id: '27000000-0000-4000-8000-000000000002', name: 'Estúdio Norte', status: 'active', ownerName: 'Bruno Reis', ownerEmail: 'bruno@norte.test', memberCount: 3, activeMemberCount: 2, projectCount: 3, deliverableCount: 5, overdueCount: 0, botCount: 1, activeBotCount: 1, whatsappStage: 'disabled', whatsappEnabled: false, lastActivityAt: null }
        ]
      };
      const replies = {
        overview,
        list_accounts: { accounts: [{ id: 'user-1', email: 'ana@aurora.test', fullName: 'Ana Lima', createdAt: new Date().toISOString(), lastSignInAt: new Date().toISOString(), emailConfirmedAt: new Date().toISOString(), customer: { agencyId: '27000000-0000-4000-8000-000000000001', role: 'owner', isActive: true }, platform: null }] },
        list_staff: { staff: [{ id: 'staff-1', email: 'admin@doti.test', full_name: 'Admin DOT', role: 'admin', is_active: true }], invitations: [] },
        list_audit: { events: [] }
      };
      window.supabase = { createClient: () => ({
        auth: { getSession: async () => ({ data: { session: { user: { id: 'staff-1' } } } }), signOut: async () => ({}) },
        rpc: async name => name === 'get_account_context' ? { data: { userId: 'staff-1', email: 'admin@doti.test', platform: { id: 'staff-1', email: 'admin@doti.test', fullName: 'Admin DOT', role: 'admin', isActive: true }, personalAgency: null }, error: null } : { data: null, error: null },
        functions: { invoke: async (_name, options) => ({ data: replies[options.body.action] || {}, error: null }) }
      }) };
    `
  }));

  await page.goto('/doti/');
  await expect(page.locator('#platformMetrics')).toContainText('AGÊNCIAS ATIVAS');
  await expect(page.locator('#platformRecentAgencies')).toContainText('Agência Aurora');
  await page.locator('[data-platform-page="agencies"]').click();
  await expect(page.locator('#agencyDirectory')).toContainText('Estúdio Norte');
  await page.locator('[data-platform-page="accounts"]').click();
  await expect(page.locator('#accountDirectory')).toContainText('ana@aurora.test');
  await page.locator('[data-platform-page="staff"]').click();
  await expect(page.locator('#staffDirectory')).toContainText('Admin DOT');
  await page.screenshot({ path: '/tmp/doti-portal-visual.png', fullPage: true });
  expect(errors).toEqual([]);
});
