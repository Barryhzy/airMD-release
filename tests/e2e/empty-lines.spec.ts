import { activePane, activeProse, paneTestId } from './helpers';
import { expect, test, type Page } from '@playwright/test';

async function openMarkdown(page: Page, markdown: string) {
  await page.goto('/');
  await page.evaluate((text) => {
    localStorage.clear();
    const bytes = new TextEncoder().encode(text);
    localStorage.setItem('airmd.vfs:/demo/示例文档.md', JSON.stringify({
      base64: btoa(String.fromCharCode(...bytes)), mtimeMs: Date.now(),
    }));
  }, markdown);
  await page.goto('/?open=' + encodeURIComponent('示例文档.md'));
  await expect(page.getByTestId('doc-title')).toHaveText('示例文档.md');
}

test('空行标记可直接打开，编辑保存和重新打开都保留全部空白段落', async ({ page }) => {
  const markdown = '## 标题\n\n正文\n\n<br />\n\n<br />\n\n后文\n\n' + Array(6).fill('<br />').join('\n\n') + '\n';
  await openMarkdown(page, markdown);
  await expect(activeProse(page)).toBeVisible();
  await expect(page.getByTestId('banner-integrity')).toBeHidden();
  await expect(activeProse(page).locator(':scope > p')).toHaveCount(10);
  await activeProse(page).locator(':scope > p').filter({ hasText: /^正文$/ }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('追加');
  await page.getByTestId('btn-save').click();
  await expect(page.getByTestId('save-state')).toHaveText('已保存');
  await page.reload();
  await expect(activeProse(page)).toBeVisible();
  await expect(page.getByTestId('banner-integrity')).toBeHidden();
  await page.getByTestId('btn-mode').click();
  await expect(paneTestId(page, 'source-textarea')).toHaveValue(markdown.replace('正文', '正文追加'));
});

test('不同写法的空行及嵌套空白段落可以往返', async ({ page }) => {
  for (const markdown of ['', '<BR>\n\n文本\n\n<br/>\n', '<br />\n', '> 引用\n>\n> <br />\n\n- <br />\n\n正文\n', '```html\n<br />\n```\n']) {
    await openMarkdown(page, markdown);
    await expect(activeProse(page)).toBeVisible();
    await expect(page.getByTestId('banner-integrity')).toBeHidden();
    await page.getByTestId('btn-mode').click();
    await page.getByTestId('btn-mode').click();
    await expect(activeProse(page)).toBeVisible();
    await expect(page.getByTestId('banner-integrity')).toBeHidden();
  }
});

test('其他 HTML 继续源码保护，源码区贴着面板顶部', async ({ page }) => {
  const markdown = '# 标题\n\n<br />\n\n<div class="x">保留内容</div>\n';
  await openMarkdown(page, markdown);
  await expect(page.getByTestId('banner-integrity')).toBeVisible();
  const source = paneTestId(page, 'source-textarea');
  await expect(source).toHaveValue(markdown);
  const area = await source.boundingBox();
  const pane = await activePane(page).boundingBox();
  // 多标签后标签栏和工具栏占了上面，但源码区仍然贴着面板顶部，不会跟着隐藏的可视化编辑器下移
  expect(area!.y).toBe(pane!.y);
  await page.getByTestId('btn-save').click();
  await page.reload();
  await expect(source).toHaveValue(markdown);
});
