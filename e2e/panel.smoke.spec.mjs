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
