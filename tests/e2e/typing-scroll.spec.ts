import { activeProse, paneTestId } from './helpers';
import { expect, test, type Page } from '@playwright/test';

async function openLongDocument(page: Page, empty: boolean) {
  const section = (index: number) => `## 第 ${index} 节\n\n${'这里是用于撑开文档的正文内容。'.repeat(12)}\n\n`;
  const markdown = Array.from({ length: 18 }, (_, i) => section(i)).join('') +
    (empty ? '<br />\n\n' : '编辑位置：在段落中输入内容。\n\n') +
    Array.from({ length: 18 }, (_, i) => section(i + 18)).join('');
  await page.goto('/');
  await page.evaluate((text) => {
    localStorage.clear();
    const bytes = new TextEncoder().encode(text);
    localStorage.setItem('airmd.vfs:/demo/示例文档.md', JSON.stringify({
      base64: btoa(String.fromCharCode(...bytes)), mtimeMs: Date.now(),
    }));
  }, markdown);
  await page.goto('/?open=' + encodeURIComponent('示例文档.md'));
  const paragraph = activeProse(page).locator(':scope > p').nth(18);
  await expect(paragraph).toBeVisible();
  await expect(page.locator('.prosemirror-virtual-cursor')).toHaveCount(0);
  await paragraph.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await paragraph.click();
  await paragraph.evaluate((el) => window.getSelection()!.collapse(el.firstChild!.nodeType === Node.TEXT_NODE ? el.firstChild! : el, el.textContent ? 6 : 0));
  await expect.poll(() => paragraph.evaluate((el) => el.contains(window.getSelection()?.anchorNode ?? null))).toBe(true);
  return paragraph;
}

for (const input of ['普通输入', '输入法组合输入', '空段落输入法组合输入']) {
  test(`长文档段中${input}不移动当前行`, async ({ page, browserName }) => {
    const paragraph = await openLongDocument(page, input.startsWith('空段落'));
    const scroller = paneTestId(page, 'editor-scroll');
    const before = { top: await scroller.evaluate((el) => el.scrollTop), y: (await paragraph.boundingBox())!.y };
    if (input === '普通输入') {
      await page.keyboard.type('abc', { delay: 100 });
    } else if (browserName === 'webkit') {
      await paragraph.dispatchEvent('compositionstart', { data: '' });
      await paragraph.dispatchEvent('compositionupdate', { data: '大法' });
      await page.keyboard.insertText('大法');
      expect(Math.abs((await paragraph.boundingBox())!.y - before.y)).toBeLessThanOrEqual(1);
      await paragraph.dispatchEvent('compositionend', { data: '大法' });
    } else {
      const session = await page.context().newCDPSession(page);
      for (const text of ['d', 'da', 'dafa']) {
        await session.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
        expect(Math.abs((await paragraph.boundingBox())!.y - before.y)).toBeLessThanOrEqual(1);
      }
      await session.send('Input.insertText', { text: '大法' });
      await session.detach();
    }
    await expect(paragraph).toContainText(input === '普通输入' ? 'abc' : '大法');
    await expect(page.getByTestId('save-state')).toHaveText('已保存');
    expect(Math.abs(await scroller.evaluate((el) => el.scrollTop) - before.top)).toBeLessThanOrEqual(1);
    expect(Math.abs((await paragraph.boundingBox())!.y - before.y)).toBeLessThanOrEqual(1);
  });
}

test('段中输入保留后续标题折叠按钮，按钮仍操作当前位置的章节', async ({ page }) => {
  await openLongDocument(page, false);
  const button = paneTestId(page, 'heading-fold-toggle').nth(18);
  const original = await button.elementHandle();
  await page.keyboard.type('abc');
  await expect(page.getByTestId('save-state')).toHaveText('已保存');
  expect(await original!.evaluate((el) => el.isConnected)).toBe(true);
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(activeProse(page).locator(':scope > p').nth(19)).toBeHidden();
});
