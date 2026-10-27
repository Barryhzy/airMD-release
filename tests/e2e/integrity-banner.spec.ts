import { expect, test } from '@playwright/test';
import { activeProse, paneTestId } from './helpers';

/**
 * 完整性横幅的全局开关：点一次「不再提示（所有 Markdown）」，
 * 之后所有含 HTML / frontmatter 的文档都直接进可视化，不再拦截。
 * 恢复入口在「更多」菜单里。
 */

const HTML_DOC = '含内嵌HTML.md';
const YAML_DOC = '带frontmatter.md';

async function openDoc(page: import('@playwright/test').Page, name: string) {
  await page.goto(`/?open=${encodeURIComponent(name)}`);
  await expect(page.getByTestId('doc-title')).toHaveText(name);
}

test('点一次「不再提示」后，重开同一个文件不再拦截', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());

  await openDoc(page, HTML_DOC);
  const banner = page.getByTestId('banner-integrity');
  await expect(banner).toBeVisible();
  await expect(paneTestId(page, 'source-textarea')).toBeVisible();

  await page.getByTestId('banner-remember').click();
  await expect(banner).toBeHidden();
  await expect(activeProse(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('airmd.integritySuppressed'))).toBe('1');

  await openDoc(page, HTML_DOC);
  await expect(page.getByTestId('banner-integrity')).toHaveCount(0);
  await expect(activeProse(page)).toBeVisible();
});

test('开关是全局的：另一个含风险语法的文档也不再拦截，且可以恢复', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());

  await openDoc(page, HTML_DOC);
  await page.getByTestId('banner-remember').click();
  await expect(page.getByTestId('banner-integrity')).toBeHidden();

  // 换成 YAML frontmatter 的文档：同样直接进可视化
  await openDoc(page, YAML_DOC);
  await expect(page.getByTestId('banner-integrity')).toHaveCount(0);
  await expect(activeProse(page)).toBeVisible();

  // 「更多」菜单里恢复提醒，重新打开就又会拦截
  await page.getByTestId('btn-more').click();
  await page.getByTestId('menu-restore-integrity').click();
  expect(await page.evaluate(() => localStorage.getItem('airmd.integritySuppressed'))).toBeNull();

  await openDoc(page, YAML_DOC);
  await expect(page.getByTestId('banner-integrity')).toBeVisible();
  await expect(paneTestId(page, 'source-textarea')).toBeVisible();
});
