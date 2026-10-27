import { activeProse, paneTestId } from './helpers';
import { expect, test, type Page } from '@playwright/test';

const markdown = '# 项目说明\n\n简介\n\n## 第一节\n\n正文 A\n\n### 子节\n\n子节内容 B\n\n## 第二节\n\n正文 C';

async function openDocument(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?open=' + encodeURIComponent('示例文档.md'));
  await expect(activeProse(page)).toBeVisible();
  await page.getByTestId('btn-mode').click();
  await paneTestId(page, 'source-textarea').fill(markdown);
  await page.getByTestId('btn-save').click();
  await expect(page.getByTestId('save-state')).toHaveText('已保存');
  await page.getByTestId('btn-mode').click();
  await expect(activeProse(page).locator('h1')).toHaveText('项目说明');
  await expect(paneTestId(page, 'outline-item')).toHaveCount(4);
}

function heading(page: Page, name: string) {
  return page.getByRole('heading', { name, exact: true });
}

test('标题折叠隐藏完整章节，保持后续同级标题和 Markdown 内容', async ({ page }) => {
  await openDocument(page);
  const toggle = heading(page, '第一节').getByTestId('heading-fold-toggle');
  const before = await page.evaluate(() => localStorage.getItem('airmd.vfs:/demo/示例文档.md'));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('正文 A', { exact: true })).toBeHidden();
  await expect(activeProse(page).locator('h3')).toBeHidden();
  await expect(heading(page, '第二节')).toBeVisible();
  await expect(page.getByText('正文 C', { exact: true })).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('已保存');
  expect(await page.evaluate(() => localStorage.getItem('airmd.vfs:/demo/示例文档.md'))).toBe(before);

  // 收起时保存、切到源码，都必须保留整节内容。
  await page.getByTestId('btn-save').click();
  await page.getByTestId('btn-mode').click();
  await expect(paneTestId(page, 'source-textarea')).toHaveValue(markdown + '\n');
  await page.getByTestId('btn-mode').click();
  await expect(heading(page, '第一节').getByTestId('heading-fold-toggle')).toHaveAttribute('aria-expanded', 'false');
  await heading(page, '第一节').getByTestId('heading-fold-toggle').click();
  await expect(page.getByText('正文 A', { exact: true })).toBeVisible();
});

test('父节展开后保留子节状态，大纲跳转会展开隐藏目标的上级章节', async ({ page }) => {
  await openDocument(page);
  await heading(page, '子节').getByTestId('heading-fold-toggle').click();
  await heading(page, '第一节').getByTestId('heading-fold-toggle').click();
  await heading(page, '第一节').getByTestId('heading-fold-toggle').click();
  await expect(heading(page, '子节')).toBeVisible();
  await expect(page.getByText('子节内容 B', { exact: true })).toBeHidden();
  await heading(page, '第一节').getByTestId('heading-fold-toggle').click();
  await paneTestId(page, 'outline-item').filter({ hasText: /^子节$/ }).click();
  await expect(heading(page, '子节')).toBeVisible();
  await expect(heading(page, '第一节').getByTestId('heading-fold-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(heading(page, '子节').getByTestId('heading-fold-toggle')).toHaveAttribute('aria-expanded', 'false');
});

test('大纲可独立收起子层级，侧栏收起再展开保留层级状态', async ({ page }) => {
  await openDocument(page);
  await page.getByRole('button', { name: '收起子标题：第一节', exact: true }).click();
  await expect(paneTestId(page, 'outline-item')).toHaveCount(3);
  await expect(heading(page, '子节')).toBeVisible();
  await page.getByRole('button', { name: '收起子标题：项目说明', exact: true }).click();
  await expect(paneTestId(page, 'outline-item')).toHaveCount(1);
  await page.getByRole('button', { name: '展开子标题：项目说明', exact: true }).click();
  await expect(paneTestId(page, 'outline-item')).toHaveCount(3);
  await page.getByRole('button', { name: '收起大纲', exact: true }).click();
  await expect(paneTestId(page, 'outline')).toBeHidden();
  await page.getByRole('button', { name: '显示大纲', exact: true }).click();
  await expect(paneTestId(page, 'outline')).toBeVisible();
  await expect(paneTestId(page, 'outline-item')).toHaveCount(3);
});

test('标题手柄与折叠按钮分开，操作按钮使用普通箭头光标', async ({ page }) => {
  await openDocument(page);
  const title = heading(page, '第一节');
  await title.hover();
  const ops = paneTestId(page, 'block-ops');
  await expect(ops).toBeVisible();
  expect(await ops.evaluate((element) => getComputedStyle(element).cursor)).toBe('default');
  const opsBox = await ops.boundingBox();
  const foldBox = await title.getByTestId('heading-fold-toggle').boundingBox();
  expect(opsBox!.x + opsBox!.width).toBeLessThanOrEqual(foldBox!.x);
  await ops.click();
  await expect(paneTestId(page, 'block-ops-menu')).toBeVisible();
  expect(await page.getByTestId('convert-h2').evaluate((element) => getComputedStyle(element).cursor)).toBe('default');
});
