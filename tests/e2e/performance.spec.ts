import { activeProse, paneTestId } from './helpers';
import { expect, test, type Page } from '@playwright/test';

async function openDocument(page: Page) {
  const markdown = '# 标题\n\n普通文字 **加粗内容** 后续文字。\n\n## 后续章节\n\n' + '用于换行的长段落文字。'.repeat(40) + '\n';
  await page.goto('/');
  await page.evaluate((text) => {
    localStorage.clear();
    localStorage.setItem('airmd.vfs:/demo/示例文档.md', JSON.stringify({
      base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), mtimeMs: Date.now(),
    }));
  }, markdown);
  await page.goto('/?open=' + encodeURIComponent('示例文档.md'));
  await expect(paneTestId(page, 'outline-item')).toHaveCount(2);
}

test('移动光标及键盘切换格式时，工具栏独立跟随当前选区', async ({ page }) => {
  await openDocument(page);
  await activeProse(page).locator('h1').click();
  await expect(page.getByTestId('block-select')).toHaveText('标题 1');
  const paragraph = activeProse(page).locator(':scope > p').first();
  await paragraph.click();
  await paragraph.evaluate((el) => window.getSelection()!.collapse(el.firstChild!, 1));
  await expect(page.getByTestId('block-select')).toHaveText('正文');
  await expect(page.getByTestId('tb-bold')).toHaveAttribute('aria-pressed', 'false');
  await paragraph.locator('strong').evaluate((el) => window.getSelection()!.collapse(el.firstChild!, 2));
  await expect(page.getByTestId('tb-bold')).toHaveAttribute('aria-pressed', 'true');
  await paragraph.evaluate((el) => window.getSelection()!.collapse(el.firstChild!, 1));
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.getByTestId('tb-bold')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('X');
  await expect(page.getByTestId('tb-undo')).toBeEnabled();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('tb-redo')).toBeEnabled();
});

test('编辑标题后大纲更新，保存及跳转仍使用最新位置', async ({ page }) => {
  await openDocument(page);
  await activeProse(page).locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('新增');
  await expect(paneTestId(page, 'outline-item').first()).toHaveText('标题新增');
  await paneTestId(page, 'outline-item').nth(1).click();
  await expect(page.getByTestId('block-select')).toHaveText('标题 2');
  await activeProse(page).locator('h2').evaluate((el) => {
    window.getSelection()!.collapse(el.lastChild!, el.lastChild!.textContent!.length);
  });
  await page.keyboard.press('Enter');
  await page.keyboard.type('章节正文');
  await page.getByTestId('btn-mode').click();
  await expect(paneTestId(page, 'source-textarea')).toHaveValue(/## 后续章节\n\n章节正文/);
  await page.getByTestId('btn-mode').click();
  await expect(paneTestId(page, 'outline-item').first()).toHaveText('标题新增');
});

test('窗口和字号变化后手柄仍对齐首行，阅读设置不修改文档', async ({ page }) => {
  await openDocument(page);
  const paragraph = activeProse(page).locator(':scope > p').last();
  await paragraph.hover({ position: { x: 50, y: 12 } });
  const handle = paneTestId(page, 'block-handle');
  await expect(handle).toBeVisible();
  const alignment = async () => page.evaluate(() => {
    const paragraph = document.querySelector('[role="tabpanel"]:not([hidden]) .ProseMirror > p:last-child')!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const line = range.getClientRects()[0];
    const handle = document.querySelector('[data-testid="block-handle"]')!.getBoundingClientRect();
    return Math.abs(handle.top + handle.height / 2 - line.top - line.height / 2);
  });
  await expect.poll(alignment).toBeLessThanOrEqual(1.5);
  await paragraph.click({ position: { x: 50, y: 12 } });
  await page.keyboard.press('ControlOrMeta+=');
  await expect.poll(alignment).toBeLessThanOrEqual(1.5);
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect.poll(alignment).toBeLessThanOrEqual(1.5);
  await expect(page.getByTestId('save-state')).toHaveText('');
});
