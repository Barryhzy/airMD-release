import { activePane, activeProse, paneTestId } from './helpers';
import { expect, test, type Page } from '@playwright/test';

const path = '/demo/示例文档.md';

async function openMarkdown(page: Page, text: string) {
  await page.goto('/');
  await page.evaluate(({ path, text }) => {
    localStorage.clear();
    localStorage.setItem(`airmd.vfs:${path}`, JSON.stringify({
      base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), mtimeMs: Date.now(),
    }));
  }, { path, text });
  await page.goto('/?open=' + encodeURIComponent('示例文档.md'));
  await expect(activeProse(page)).toBeVisible();
}

async function readText(page: Page, file = path) {
  return page.evaluate((file) => {
    const entry = JSON.parse(localStorage.getItem(`airmd.vfs:${file}`) ?? 'null');
    return entry ? new TextDecoder().decode(Uint8Array.from(atob(entry.base64), (c) => c.charCodeAt(0))) : '';
  }, file);
}

async function settleFrames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('新建只新开标签，原文档的输入仍在并已落盘', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openMarkdown(page, '# 标题\n\n正文\n');
  await activeProse(page).locator(':scope > p').click();
  await page.keyboard.type('XYZ');
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('document-tab')).toHaveCount(2);
  expect(errors).toEqual([]);
  // 旧标签没被销毁：切回去内容还在，自动保存也已把最后的输入写进磁盘
  await page.getByTestId('document-tab').filter({ hasText: '示例文档.md' }).click();
  await expect(activeProse(page)).toContainText('XYZ');
  await expect.poll(async () => (await readText(page)).includes('XYZ')).toBe(true);
});

test('未命名草稿关闭标签时取消会保留，保存并继续会先写入再关闭', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-new').click();
  await expect(activeProse(page)).toBeVisible();
  await activeProse(page).click();
  await page.keyboard.type('未保存草稿');

  const closeDraft = () => page.locator('.document-tab').filter({ hasText: '未命名 1' }).getByTestId('close-document-tab').click();
  const modal = page.getByTestId('unsaved-modal');

  await closeDraft();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('document-tab')).toHaveCount(1);
  await expect(activeProse(page)).toContainText('未保存草稿');

  await closeDraft();
  await expect(modal).toBeVisible();
  await modal.getByTestId('modal-submit').click();
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('document-tab')).toHaveCount(0);
  // 未命名文档的另存为文件名由标题推导，这里只关心内容真的落到了虚拟盘
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('airmd.vfs:'))
    .some((key) => {
      const entry = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (!entry) return false;
      const text = new TextDecoder().decode(Uint8Array.from(atob(entry.base64), (c) => c.charCodeAt(0)));
      return text.includes('未保存草稿');
    }))).toBe(true);
});

test('关闭自动保存后关闭标签需要明确放弃，取消时保留原文档', async ({ page }) => {
  const original = '# 标题\n\n原有正文\n';
  await openMarkdown(page, original);
  await page.getByTestId('btn-more').click();
  await page.getByTestId('menu-toggle-autosave').click();
  await page.getByTestId('btn-mode').click();
  await paneTestId(page, 'source-textarea').fill('# 标题\n\n未保存修改\n');

  const closeTab = () => page.locator('.document-tab').filter({ hasText: '示例文档.md' }).getByTestId('close-document-tab').click();
  const modal = page.getByTestId('unsaved-modal');

  await closeTab();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(paneTestId(page, 'source-textarea')).toHaveValue('# 标题\n\n未保存修改\n');

  await closeTab();
  await expect(modal).toBeVisible();
  await modal.getByTestId('modal-discard').click();
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('document-tab')).toHaveCount(0);
  expect(await readText(page)).toBe(original);
});

const tableDoc = '表格前正文\n\n| 甲 | 乙 |\n| --- | --- |\n| 保留内容 | 第二格 |\n\n表格后正文\n';

test('单击表格单元格直接进入文本编辑，输入不会替换原有内容', async ({ page }) => {
  await openMarkdown(page, tableDoc);
  const cell = activeProse(page).locator('td').first();
  await cell.click();
  await settleFrames(page);
  expect(await cell.evaluate((el) => {
    const selection = window.getSelection();
    return Boolean(selection?.isCollapsed && el.contains(selection.anchorNode));
  })).toBe(true);
  await page.keyboard.type('X');
  expect((await cell.textContent())!.replace('X', '')).toBe('保留内容');
});

test('表格全选不被延迟点击覆盖，清空后撤销重做只影响表格', async ({ page }) => {
  await openMarkdown(page, tableDoc);
  const table = activeProse(page).locator('table.children');
  await activeProse(page).locator('td').first().click();
  await page.keyboard.press('Control+a');
  await settleFrames(page);
  await expect(activePane(page).locator('.selectedCell')).toHaveCount(4);
  await page.keyboard.press('Backspace');
  await expect(activeProse(page)).toContainText('表格前正文');
  await expect(activeProse(page)).toContainText('表格后正文');
  await expect(table).not.toContainText('保留内容');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(table).toContainText('保留内容');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(table).not.toContainText('保留内容');
  await expect(activeProse(page)).toContainText('表格后正文');
});

test('中文候选期间不写入拼音，提交后保存并可撤销重做', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '使用 Chromium CDP 驱动组合输入');
  const original = '# 标题\n\n正文\n';
  await openMarkdown(page, original);
  const paragraph = activeProse(page).locator(':scope > p');
  await paragraph.click();
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 });
  // 等过现有内容通知和自动保存周期，确认未提交候选始终没有落盘。
  await page.waitForTimeout(1500);
  expect(await readText(page)).toBe(original);
  await session.send('Input.insertText', { text: '中文' });
  await session.detach();
  await expect(page.getByTestId('save-state')).toHaveText('已保存');
  expect(await readText(page)).toContain('中文');
  expect(await readText(page)).not.toContain('zhong');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(paragraph).toHaveText('正文');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(paragraph).toContainText('中文');
});

test('源码模式的中文候选也不落盘，完成选字后再保存', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '使用 Chromium CDP 驱动组合输入');
  const original = '# 标题\n\n正文\n';
  await openMarkdown(page, original);
  await page.getByTestId('btn-mode').click();
  const source = paneTestId(page, 'source-textarea');
  await source.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: 'pinyin', selectionStart: 6, selectionEnd: 6 });
  await page.waitForTimeout(1500);
  expect(await readText(page)).toBe(original);
  await session.send('Input.insertText', { text: '中文提交' });
  await session.detach();
  await expect(page.getByTestId('save-state')).toHaveText('已保存');
  expect(await readText(page)).toContain('中文提交');
  expect(await readText(page)).not.toContain('pinyin');
});

test('取消中文候选不保存拼音，也不改写原文件的 Markdown 写法', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '使用 Chromium CDP 驱动组合输入');
  const original = '* 保留星号列表\n\n正文\n';
  await openMarkdown(page, original);
  await activeProse(page).locator(':scope > p').click();
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: 'ping', selectionStart: 4, selectionEnd: 4 });
  await page.waitForTimeout(1300);
  expect(await readText(page)).toBe(original);
  await session.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  await page.waitForTimeout(1300);
  expect(await readText(page)).toBe(original);
  await session.send('Input.insertText', { text: '正常输入' });
  await session.detach();
  await expect(page.getByTestId('save-state')).toHaveText('已保存');
  expect(await readText(page)).toContain('正常输入');
});

test('悬停后继续输入再插入块，不会从段落中间截断内容', async ({ page }) => {
  await openMarkdown(page, '# 标题\n\n短正文\n\n后文\n');
  await expect(paneTestId(page, 'outline-item')).toHaveCount(1);
  const paragraph = activeProse(page).locator(':scope > p').first();
  await paragraph.hover();
  await expect(paneTestId(page, 'block-handle')).toBeVisible();
  await paragraph.click();
  await page.keyboard.type('XYZ');
  const edited = await paragraph.textContent();
  await paneTestId(page, 'block-add').click();
  await page.getByTestId('insert-paragraph').click();
  await expect(activeProse(page).locator(':scope > p')).toHaveCount(3);
  await expect(activeProse(page).locator(':scope > p').nth(0)).toHaveText(edited!);
  await expect(activeProse(page).locator(':scope > p').nth(1)).toHaveText('');
  await expect(activeProse(page).locator(':scope > p').nth(2)).toHaveText('后文');
});
