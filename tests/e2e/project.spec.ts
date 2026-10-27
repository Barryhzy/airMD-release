import { activeProse, paneTestId } from './helpers';
import { expect, test, type Page } from '@playwright/test';

const root = '/demo';
const a = `${root}/项目笔记/甲.md`;
const b = `${root}/项目笔记/子目录/乙.MD`;
async function put(page: Page, path: string, text: string) {
  await page.evaluate(({ path, text }) => {
    localStorage.setItem(`airmd.vfs:${path}`, JSON.stringify({ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), mtimeMs: Date.now() }));
  }, { path, text });
}
async function read(page: Page, path: string) {
  return page.evaluate((path) => new TextDecoder().decode(Uint8Array.from(atob(JSON.parse(localStorage.getItem(`airmd.vfs:${path}`)!).base64), (c) => c.charCodeAt(0))), path);
}
async function start(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await put(page, a, '# 甲\n\n甲的正文\n');
  await put(page, b, '# 乙\n\n乙的正文\n');
  await put(page, `${root}/node_modules/隐藏.md`, '# 不应出现');
  await put(page, `${root}/项目笔记/图片.png`, 'not Markdown');
  await page.reload();
  await page.getByTestId('btn-open-folder').click();
  await expect(page.getByTestId('project-sidebar')).toBeVisible();
  await page.getByTestId('project-folder').filter({ hasText: /^项目笔记$/ }).click();
}
const file = (page: Page, relativePath: string) => page.getByTestId('project-file').and(page.locator(`[data-path="${relativePath}"]`));
async function openA(page: Page) {
  await file(page, '项目笔记/甲.md').click();
  await expect(page.getByTestId('doc-title')).toHaveText('甲.md');
  await expect(activeProse(page).locator('h1')).toHaveText('甲');
}

test('项目树只显示 Markdown，路径筛选可打开深层文件，立即切换保存最新输入', async ({ page }) => {
  await start(page);
  await expect(page.getByTestId('project-sidebar')).not.toContainText('隐藏.md');
  await expect(page.getByTestId('project-sidebar')).not.toContainText('图片.png');
  await openA(page);
  await activeProse(page).locator(':scope > p').click();
  await page.keyboard.type('XYZ');
  await page.getByRole('searchbox', { name: '筛选项目文件' }).fill('子目录/乙');
  await file(page, '项目笔记/子目录/乙.MD').click();
  await expect(activeProse(page).locator('h1')).toHaveText('乙');
  // 切换标签不再同步写盘，等自动保存把甲的改动落下去
  await expect.poll(async () => (await read(page, a)).includes('XYZ')).toBe(true);
  await expect(file(page, '项目笔记/子目录/乙.MD')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('searchbox', { name: '筛选项目文件' }).fill('');
  await expect(file(page, '项目笔记/子目录/乙.MD')).toBeVisible();
});

for (const choice of ['取消', '放弃', '保存']) {
  test(`关闭有未保存改动的标签时${choice}`, async ({ page }) => {
    await start(page);
    await openA(page);
    await page.getByTestId('btn-more').click();
    await page.getByTestId('menu-toggle-autosave').click();
    await activeProse(page).locator(':scope > p').click();
    await page.keyboard.type('UNSAVED');

    // 多标签语义：项目树里点另一个文件只新开标签，不会丢下未保存的修改
    await page.getByRole('searchbox', { name: '筛选项目文件' }).fill('乙.MD');
    await file(page, '项目笔记/子目录/乙.MD').click();
    await expect(page.getByTestId('doc-title')).toHaveText('乙.MD');
    await expect(page.getByTestId('document-tab')).toHaveCount(2);
    expect(await read(page, a)).not.toContain('UNSAVED');

    // 切回甲、点标签上的 × 关闭时，才询问要不要保存
    await page.getByTestId('document-tab').filter({ hasText: '甲.md' }).click();
    await expect(page.getByTestId('doc-title')).toHaveText('甲.md');
    const closeA = () => page.locator('.document-tab').filter({ hasText: '甲.md' }).getByTestId('close-document-tab').click();
    await closeA();

    const modal = page.getByTestId('unsaved-modal');
    await expect(modal).toBeVisible();

    if (choice === '取消') {
      await modal.getByRole('button', { name: '取消', exact: true }).click();
      await expect(modal).toBeHidden();
      await expect(page.getByTestId('document-tab')).toHaveCount(2);
      await expect(activeProse(page)).toContainText('UNSAVED');
      expect(await read(page, a)).not.toContain('UNSAVED');
    } else {
      await modal.getByTestId(choice === '保存' ? 'modal-submit' : 'modal-discard').click();
      await expect(modal).toBeHidden();
      await expect(page.getByTestId('document-tab')).toHaveCount(1);
      expect((await read(page, a)).includes('UNSAVED')).toBe(choice === '保存');
    }
  });
}

test('项目显示、关闭和重新打开不替换当前文档或销毁编辑器', async ({ page }) => {
  await start(page);
  await openA(page);
  const editor = await activeProse(page).elementHandle();
  await page.getByTestId('btn-project').click();
  await expect(page.getByTestId('project-sidebar')).toBeHidden();
  await page.getByTestId('btn-project').click();
  await page.getByTestId('project-close').click();
  await expect(page.getByTestId('project-sidebar')).toBeHidden();
  await page.getByTestId('btn-open-folder').click();
  expect(await editor!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.getByTestId('doc-title')).toHaveText('甲.md');
});

test('恢复上次项目与侧栏显示偏好，独立打开项目外文件不改变索引', async ({ page }) => {
  await start(page);
  await openA(page);
  await page.getByTestId('btn-project').click();
  await page.reload();
  await expect(page.getByTestId('btn-project')).toBeEnabled();
  await expect(page.getByTestId('project-sidebar')).toBeHidden();
  await page.getByTestId('btn-project').click();
  await expect(page.getByTestId('project-folder').filter({ hasText: /^项目笔记$/ })).toBeVisible();
  // 浏览器演示只在启动参数中选内置示例；将已记住的项目改为子文件夹即可验证项目外文档。
  await page.evaluate(() => localStorage.setItem('airmd.projectRoot', '/demo/项目笔记'));
  await page.goto('/?open=' + encodeURIComponent('示例文档.md'));
  await expect(page.getByTestId('doc-title')).toHaveText('示例文档.md');
  await expect(page.getByTestId('project-sidebar')).toContainText('项目笔记');
  await expect(page.locator('.project-file.is-active')).toHaveCount(0);
});

test('刷新和重新获得焦点可更新索引，源代码编辑区及正文保持可用', async ({ page }) => {
  await start(page);
  await openA(page);
  await page.getByTestId('btn-mode').click();
  await put(page, '/demo/新文件.md', '# 新文件');
  await page.getByTestId('project-refresh').click();
  await expect(file(page, '新文件.md')).toBeVisible();
  await expect(paneTestId(page, 'source-textarea')).toHaveValue(/甲的正文/);
  await put(page, '/demo/焦点新增.md', '# 焦点新增');
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
  await expect(file(page, '焦点新增.md')).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('airmd.vfs:/demo/新文件.md'));
  await page.getByTestId('project-refresh').click();
  await expect(file(page, '新文件.md')).toHaveCount(0);
});

test('大项目默认折叠目录，筛选仍可直接定位文件', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    for (let i = 0; i < 3000; i++) {
      localStorage.setItem(`airmd.vfs:/demo/docs/目录-${Math.floor(i / 30)}/file-${i}.md`, JSON.stringify({ base64: btoa('# Large project'), mtimeMs: Date.now() }));
    }
  });
  await page.reload();
  const started = Date.now();
  await page.getByTestId('btn-open-folder').click();
  await expect(page.locator('.project-sidebar__summary')).toHaveText(/300\d 个 Markdown 文件/);
  const openMs = Date.now() - started;
  expect(await page.getByTestId('project-file').count()).toBeLessThan(10);
  await page.getByRole('searchbox', { name: '筛选项目文件' }).fill('目录-99/file-2999.md');
  await expect(page.getByTestId('project-file')).toHaveCount(1);
  await page.getByTestId('project-file').click();
  await expect(activeProse(page)).toContainText('Large project');
  await testInfo.attach('project-ui-measurement', { body: JSON.stringify({ openMs, files: 3000, renderedRootFiles: '<10', browser: testInfo.project.name }), contentType: 'application/json' });
});
