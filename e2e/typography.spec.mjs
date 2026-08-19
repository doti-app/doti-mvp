import { expect, test } from '@playwright/test';

const viewports = [
  { width: 390, height: 844, zoom: '1' },
  { width: 1440, height: 900, zoom: '1.04' },
  { width: 1920, height: 1080, zoom: '1.08' }
];

for (const viewport of viewports) {
  test(`mantém a tipografia legível e o layout íntegro em ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const typography = await page.evaluate(() => {
      const bodyStyle = getComputedStyle(document.body);
      const headingStyle = getComputedStyle(document.querySelector('h1'));

      return {
        bodyFont: bodyStyle.fontFamily,
        headingFont: headingStyle.fontFamily,
        headingWeight: headingStyle.fontWeight,
        zoom: bodyStyle.zoom,
        viewportWidth: document.documentElement.clientWidth,
        contentWidth: document.documentElement.scrollWidth
      };
    });

    expect(typography.bodyFont).toContain('Inter');
    expect(typography.headingFont).toContain('Marble');
    expect(typography.headingWeight).toBe('500');
    expect(typography.zoom).toBe(viewport.zoom);
    expect(typography.contentWidth).toBeLessThanOrEqual(typography.viewportWidth);
    await expect.poll(() => page.evaluate(() => document.fonts.check('400 16px Inter'))).toBe(true);
    await expect.poll(() => page.evaluate(() => document.fonts.check('700 16px Marble'))).toBe(true);
  });
}

test('usa Marble semibold nos títulos dos cards de fluxos', async ({ page }) => {
  await page.goto('/#fluxos');

  const flowTitle = page.locator('.workflow-card h2').first();
  await expect(flowTitle).toBeVisible();
  await expect(flowTitle).toHaveCSS('font-family', /Marble/);
  await expect(flowTitle).toHaveCSS('font-weight', '600');
});
