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

  for (const pageId of ['demandas', 'aprovacoes', 'fluxos', 'clientes', 'curadoria-chatbot', 'equipe', 'whatsapp']) {
    await page.locator(`[data-page="${pageId}"]`).click();
    await expect(page.locator(`#${pageId}`)).toHaveClass(/active/);
  }

  await page.locator('#profileSettingsEntry').click();
  await expect(page.locator('#meus-dados')).toHaveClass(/active/);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('cliente acessa somente suas aprovações e devolve a demanda para ajustes', async ({ page }) => {
  await page.addInitScript(state => {
    localStorage.setItem('doti-agency-live-v4', JSON.stringify(state));
  }, {
    version: 3,
    revision: 0,
    groups: [
      { id: 'g-producao', name: 'Produção', initials: 'PR' },
      { id: 'g-cliente-portal', name: 'Representante do cliente', initials: 'CL', isClientGroup: true }
    ],
    workflows: [],
    clients: [
      { id: 'local-client', name: 'Café Aurora' },
      { id: 'outro-cliente', name: 'Outro cliente' }
    ],
    projects: [
      { id: 'projeto-local', clientId: 'local-client', name: 'Campanha de lançamento', due: '2026-08-30' },
      { id: 'projeto-terceiro', clientId: 'outro-cliente', name: 'Projeto sigiloso', due: '2026-08-30' }
    ],
    deliverables: [
      {
        id: 'entrega-local', projectId: 'projeto-local', name: 'Carrossel da campanha', category: 'Design', color: 'social',
        status: 'active', stepIndex: 1, due: '2026-08-20', note: 'Revise textos, cores e chamada principal.',
        links: [{ id: 'link-1', href: 'https://example.com/aprovacao', label: 'Prévia navegável' }],
        attachments: [], approvalDecisions: [],
        steps: [
          { id: 'etapa-producao', name: 'Criação', groupId: 'g-producao', tasks: [] },
          { id: 'etapa-aprovacao', name: 'Aprovação do cliente', groupId: 'g-cliente-portal', tasks: [] }
        ]
      },
      {
        id: 'entrega-terceiro', projectId: 'projeto-terceiro', name: 'Material de outro cliente', category: 'Design', color: 'social',
        status: 'active', stepIndex: 1, note: '', links: [], attachments: [], approvalDecisions: [],
        steps: [
          { id: 'etapa-terceiro-producao', name: 'Criação', groupId: 'g-producao', tasks: [] },
          { id: 'etapa-terceiro-aprovacao', name: 'Aprovação do cliente', groupId: 'g-cliente-portal', tasks: [] }
        ]
      }
    ],
    activity: []
  });

  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/?localRole=client#clientes');

  await expect(page).toHaveURL(/#aprovacoes$/);
  await expect(page.locator('.approvals-page-title h1')).toHaveText('Minhas aprovações');
  await expect(page.locator('.nav-item:not(#approvalNavItem):visible')).toHaveCount(0);
  await expect(page.locator('#aprovacoes')).toHaveClass(/active/);
  await expect(page.locator('#clientes')).not.toHaveClass(/active/);
  await expect(page.locator('.approval-card')).toHaveCount(1);
  await expect(page.locator('.approval-card')).toContainText('Carrossel da campanha');
  await expect(page.locator('body')).not.toContainText('Material de outro cliente');
  await page.screenshot({ path: '/tmp/client-approvals-visual.png', fullPage: true });

  await page.locator('.approval-card').click();
  await expect(page.locator('.doti-modal')).toContainText('Revise textos, cores e chamada principal.');
  await page.locator('.reject-step-btn').click();
  await expect(page.locator('[data-approval-status]')).toContainText('Explique os ajustes necessários');
  await page.locator('textarea[name="comment"]').fill('Aumentar o contraste do título');
  await page.locator('.reject-step-btn').click();

  await expect(page.locator('.approval-empty')).toContainText('Tudo em dia por aqui');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('doti-agency-live-v4')));
  const deliverable = persisted.deliverables.find(item => item.id === 'entrega-local');
  expect(deliverable.stepIndex).toBe(0);
  expect(deliverable.approvalDecisions[0].decision).toBe('rejected');
  expect(deliverable.approvalDecisions[0].comment).toBe('Aumentar o contraste do título');
  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('gestão da equipe exige um cliente ao criar o perfil Cliente da agência', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('doti-agency-live-v4', JSON.stringify({
      version: 3,
      groups: [{ id: 'g-atendimento', name: 'Atendimento', initials: 'AT' }],
      workflows: [],
      clients: [{ id: 'client-aurora', name: 'Café Aurora', color: '#ffd400' }],
      projects: [], deliverables: [], activity: []
    }));
    localStorage.removeItem('doti-local-team-v1');
  });
  await page.goto('/');
  await page.locator('[data-page="equipe"]').click();
  await page.locator('#inviteMemberButton').click();

  const modal = page.locator('.team-invite-modal');
  await modal.locator('input[name="fullName"]').fill('Carlos Cliente');
  await modal.locator('input[name="email"]').fill('carlos@cliente.test');
  await modal.locator('input[name="role"][value="client"]').check();
  await expect(modal.locator('.team-client-picker')).toBeVisible();
  await expect(modal.locator('select[name="clientId"]')).toHaveAttribute('required', '');
  await modal.locator('select[name="clientId"]').selectOption('client-aurora');
  await modal.locator('button[type="submit"]').click();

  const row = page.locator('.team-member').filter({ hasText: 'Carlos Cliente' });
  await expect(row).toContainText('Cliente da agência');
  await expect(row).toContainText('Vinculado a Café Aurora');
});

test('integrante vê no filtro somente os grupos atribuídos', async ({ page }) => {
  await page.addInitScript(() => {
    const groups = [
      { id: 'g-atendimento', name: 'Atendimento', initials: 'AT' },
      { id: 'g-copy', name: 'Copywriting', initials: 'CP' },
      { id: 'g-design', name: 'Design', initials: 'DS' }
    ];
    localStorage.setItem('doti-agency-live-v4', JSON.stringify({
      version: 4, revision: 0, initialized: true, groups,
      workflows: [], clients: [], projects: [], deliverables: [], activity: []
    }));
    localStorage.setItem('doti-local-team-v1', JSON.stringify({
      members: [{
        id: 'local-member-copy', email: 'copy@doti.test', full_name: 'Pessoa Copy',
        role: 'member', is_active: true, group_ids: ['g-atendimento', 'g-copy']
      }],
      invitations: [], currentUserId: 'local-owner', currentRole: 'owner'
    }));
  });

  await page.goto('/?localRole=member&localUser=copy%40doti.test#demandas');
  await expect(page.locator('#groupFilter option')).toHaveText([
    'Todos os meus grupos', 'Atendimento', 'Copywriting'
  ]);
  await expect(page.locator('#groupFilter option', { hasText: 'Design' })).toHaveCount(0);
  await expect(page.locator('[data-page="equipe"]')).toBeHidden();
});

test('equipe distribui dados e ações sem vazamento em tela intermediária', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    localStorage.setItem('doti-agency-live-v4', JSON.stringify({
      version: 4, revision: 0, initialized: true,
      groups: [{ id: 'g-design', name: 'Design', initials: 'DS' }],
      workflows: [], clients: [], projects: [], deliverables: [], activity: []
    }));
    localStorage.setItem('doti-local-team-v1', JSON.stringify({
      members: [
        { id: 'local-owner', email: 'local@doti.dev', full_name: 'Ambiente local', role: 'owner', is_active: true },
        { id: 'member-pending', email: 'pessoa@doti.test', full_name: 'Pessoa convidada', role: 'member', is_active: true, group_ids: ['g-design'] }
      ],
      invitations: [{ id: 'invite-pending', email: 'pessoa@doti.test', full_name: 'Pessoa convidada', role: 'member', status: 'pending', group_ids: ['g-design'] }],
      currentUserId: 'local-owner', currentRole: 'owner'
    }));
  });

  await page.goto('/#equipe');
  const row = page.locator('.team-member').filter({ hasText: 'pessoa@doti.test' });
  await expect(row.getByRole('button', { name: /Reenviar e-mail/ })).toHaveText('Reenviar');
  await expect(row.getByRole('button', { name: /Desativar acesso/ })).toHaveText('Desativar');
  const layoutColumns = await page.locator('.team-layout').evaluate(element => getComputedStyle(element).gridTemplateColumns);
  expect(layoutColumns.trim().split(/\s+/)).toHaveLength(1);
  const overflow = await row.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
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
        agency_team_list: { members: [{ id: 'owner-1', email: 'ana@aurora.test', full_name: 'Ana Lima', role: 'owner', client_id: null, client_name: '', is_active: true }, { id: 'client-user', email: 'cliente@aurora.test', full_name: 'Carlos Cliente', role: 'client', client_id: 'client-1', client_name: 'Café Aurora', is_active: true }], invitations: [], clients: [{ id: 'client-1', name: 'Café Aurora' }] },
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
  await page.locator('[data-platform-page="agencies"]').click();
  await page.locator('#agencyDirectory [data-open-agency]').first().click();
  await page.locator('#agencyDialog [data-team-agency]').click();
  await expect(page.locator('[data-member-role="client-user"]')).toHaveValue('client');
  await expect(page.locator('#agencyTeamDialogContent')).toContainText('Café Aurora');
  await page.screenshot({ path: '/tmp/doti-portal-visual.png', fullPage: true });
  expect(errors).toEqual([]);
});
