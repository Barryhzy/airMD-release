import { activePane, activeProse, paneTestId } from './helpers';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE = '示例文档.md';
const HTML_DOC = '含内嵌HTML.md';

async function openDoc(page: Page, name: string) {
  await page.goto(`/?open=${encodeURIComponent(name)}`);
  await expect(page.getByTestId('doc-title')).toHaveText(name);
  await expect(paneTestId(page, 'editor-scroll')).toBeVisible();
  await expect(activeProse(page)).toBeVisible();
}

async function readVirtualFile(page: Page, path: string): Promise<string> {
  return page.evaluate((p) => {
    const raw = localStorage.getItem(`airmd.vfs:${p}`);
    if (!raw) return '';
    const binary = atob(JSON.parse(raw).base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }, path);
}

test.beforeEach(async ({ page }) => {
  // 每个用例都从干净的虚拟文件系统开始
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
});

test('打开本地 Markdown 并以所见即所得方式呈现', async ({ page }) => {
  await openDoc(page, SAMPLE);

  const prose = activeProse(page);
  await expect(prose).toContainText('airMD · 使用说明');
  await expect(prose.locator('h1')).toHaveCount(1);
  // 默认不显示 Markdown 控制符
  await expect(prose).not.toContainText('##');
  await expect(prose).not.toContainText('**');
  // 结构性内容被真实渲染
  expect(await prose.locator('table').count()).toBeGreaterThanOrEqual(1);
  await expect(prose.locator('table th, table td').first()).toBeVisible();
  expect(await prose.locator('pre').count()).toBeGreaterThanOrEqual(1);
  // 相对路径的本地图片会被解析成可显示的 data URL（文档里仍然是原路径）
  await expect(prose.locator('img:not(.ProseMirror-separator)').first()).toHaveAttribute(
    'src',
    /^data:image\//,
  );
});

test('修改文字后自动保存，重新打开仍然存在', async ({ page }) => {
  await openDoc(page, SAMPLE);
  const prose = activeProse(page);

  await prose.locator('p').first().click();
  await expect(prose).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('E2E 自动保存标记');

  await expect(page.getByTestId('save-state')).toHaveText('已保存', { timeout: 20_000 });

  const stored = await readVirtualFile(page, '/demo/示例文档.md');
  expect(stored).toContain('E2E 自动保存标记');

  await page.reload();
  await expect(page.getByTestId('doc-title')).toHaveText(SAMPLE);
  await expect(activeProse(page)).toContainText('E2E 自动保存标记');
});

test('Ctrl+B 快捷键与工具栏都能写入标准 Markdown 加粗', async ({ page }) => {
  await openDoc(page, SAMPLE);
  const prose = activeProse(page);

  await prose.locator('p').first().click();
  await expect(prose).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('快捷键加粗');

  await page.keyboard.down('Shift');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.keyboard.press('ControlOrMeta+b');

  await expect(prose.locator('strong').filter({ hasText: '快捷键加粗' })).toHaveCount(1);
  await expect(page.getByTestId('save-state')).toHaveText('已保存', { timeout: 20_000 });

  const stored = await readVirtualFile(page, '/demo/示例文档.md');
  expect(stored).toContain('**快捷键加粗**');
});

test('撤销与重做可用', async ({ page }) => {
  await openDoc(page, SAMPLE);
  const prose = activeProse(page);

  await prose.locator('p').first().click();
  await expect(prose).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('撤销测试字样');
  await expect(prose).toContainText('撤销测试字样');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(prose).not.toContainText('撤销测试字样');

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(prose).toContainText('撤销测试字样');
});

test('工具栏插入链接，光标处会生成链接文字并写成标准 Markdown', async ({ page }) => {
  await openDoc(page, SAMPLE);
  const prose = activeProse(page);

  await prose.locator('p').first().click();
  await expect(prose).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');

  await page.getByTestId('tb-link').click();
  await expect(page.getByTestId('link-modal')).toBeVisible();
  await page.getByTestId('link-input').fill('https://example.com/a');
  await page.getByTestId('modal-submit').click();

  const link = prose.locator('a[href="https://example.com/a"]');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('example.com/a');

  await expect(page.getByTestId('save-state')).toHaveText('已保存', { timeout: 20_000 });
  const stored = await readVirtualFile(page, '/demo/示例文档.md');
  expect(stored).toContain('[example.com/a](https://example.com/a)');
});

test('左侧手柄与块首行垂直居中对齐', async ({ page }) => {
  await openDoc(page, SAMPLE);
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('doc-title')).toHaveText(/未打开文档|未命名/);

  const prose = activeProse(page);
  await prose.click();
  await expect(prose).toBeFocused();
  // 写一段够长的文字让它折行，手柄要贴第一行而不是整块中心
  await page.keyboard.type(
    '这一行故意写得很长，长到必须折行，用来验证左侧的插入与拖拽手柄是贴在第一行的中线上，而不是跟着整块高度飘到中间去。',
  );
  await page.keyboard.press('Enter');
  await page.keyboard.type('# 一级标题');
  await page.waitForTimeout(200);

  const check = async (index: number) => {
    const block = prose.locator(':scope > *:not(.prosemirror-virtual-cursor)').nth(index);
    const box = await block.boundingBox();
    if (!box) throw new Error('块不存在');
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    await expect(paneTestId(page, 'block-handle')).toBeVisible();

    const delta = await page.evaluate((i) => {
      const el = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .ProseMirror > *')].filter((n) => !n.classList.contains('prosemirror-virtual-cursor'))[i];
      const handle = document.querySelector('.block-handle');
      if (!el || !handle) return 999;
      const range = document.createRange();
      range.selectNodeContents(el);
      const firstLine = range.getClientRects()[0];
      const hr = handle.getBoundingClientRect();
      const lineCenter = firstLine ? firstLine.top + firstLine.height / 2 : 0;
      return Math.abs(hr.top + hr.height / 2 - lineCenter);
    }, index);

    expect(delta).toBeLessThanOrEqual(1.5);
  };

  await check(0); // 折行的正文段落
  await check(1); // 标题
});

test('切换到标题后手柄立刻跟到新位置（不用再晃鼠标）', async ({ page }) => {
  await openDoc(page, SAMPLE);
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('doc-title')).toHaveText(/未打开文档|未命名/);

  const prose = activeProse(page);
  await prose.click();
  await page.keyboard.type('切换标题测试');

  const box = await prose.locator('p').first().boundingBox();
  if (!box) throw new Error('空文档应有一个段落');
  await page.mouse.move(box.x + 60, box.y + 10);
  await expect(paneTestId(page, 'block-handle')).toBeVisible();

  await paneTestId(page, 'block-ops').click();
  await page.getByTestId('convert-h1').click();
  await expect(prose.locator('h1')).toHaveText('切换标题测试');

  // 鼠标保持不动：手柄必须在文档变化后自己跟过去
  await page.waitForTimeout(150);
  const delta = await page.evaluate(() => {
    const heading = document.querySelector('[role="tabpanel"]:not([hidden]) .ProseMirror h1');
    const handle = document.querySelector('.block-handle');
    if (!heading || !handle) return 999;
    const range = document.createRange();
    range.selectNodeContents(heading);
    const line = range.getClientRects()[0];
    if (!line) return 999;
    const hr = handle.getBoundingClientRect();
    return Math.abs(hr.top + hr.height / 2 - (line.top + line.height / 2));
  });

  expect(delta).toBeLessThanOrEqual(1.5);
});

test('连续回车把内容挤下去后，手柄跟着指针下面的块走', async ({ page }) => {
  await openDoc(page, SAMPLE);
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('doc-title')).toHaveText(/未打开文档|未命名/);

  const prose = activeProse(page);
  await prose.click();
  await page.keyboard.type('x');
  await page.keyboard.press('Control+Home');

  const box = await prose.locator('p').first().boundingBox();
  if (!box) throw new Error('应有段落');
  const mx = box.x + 30;
  const my = box.y + 10;
  await page.mouse.move(mx, my);
  await expect(paneTestId(page, 'block-handle')).toBeVisible();

  // 连按回车：原段落被挤到下面，指针现在压在一个新的空段落上
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Enter');
  await page.waitForTimeout(250);

  const delta = await page.evaluate(({ x, y }) => {
    const proseEl = document.querySelector('[role="tabpanel"]:not([hidden]) .ProseMirror');
    const handle = document.querySelector('.block-handle');
    if (!proseEl || !handle) return 999;

    let under = document.elementFromPoint(x, y);
    while (under && under.parentElement !== proseEl) under = under.parentElement;
    if (!under) return 999;

    const range = document.createRange();
    range.selectNodeContents(under);
    const line = range.getClientRects()[0];
    if (!line) return 999;

    const hr = handle.getBoundingClientRect();
    return Math.abs(hr.top + hr.height / 2 - (line.top + line.height / 2));
  }, { x: mx, y: my });

  expect(delta).toBeLessThanOrEqual(1.5);
});

test('悬停时手柄左侧显示这行的样式徽标（正文不显示）', async ({ page }) => {
  await openDoc(page, SAMPLE);

  await activeProse(page).locator('h1').first().hover();
  await expect(paneTestId(page, 'block-handle')).toBeVisible();
  await expect(paneTestId(page, 'block-kind')).toHaveText('H1');

  // 正文不显示徽标
  await activeProse(page).locator('p').first().hover();
  await expect(paneTestId(page, 'block-handle')).toBeVisible();
  await expect(paneTestId(page, 'block-kind')).toHaveCount(0);
});

test('块菜单会标出这个块当前的样式', async ({ page }) => {
  await openDoc(page, SAMPLE);

  await activeProse(page).locator('h1').first().hover();
  await expect(paneTestId(page, 'block-handle')).toBeVisible();
  await paneTestId(page, 'block-ops').click();

  await expect(paneTestId(page, 'block-ops-menu')).toBeVisible();
  await expect(paneTestId(page, 'current-kind')).toHaveText('当前：标题 1');
  await expect(page.getByTestId('convert-h1')).toHaveClass(/is-active/);
  await expect(page.getByTestId('convert-paragraph')).not.toHaveClass(/is-active/);

  // 换一个类型的块，标出来的应该是它自己的样式
  await page.keyboard.press('Escape');
  await activeProse(page).locator('p').first().hover();
  await paneTestId(page, 'block-ops').click();
  await expect(paneTestId(page, 'current-kind')).toHaveText('当前：正文');
  await expect(page.getByTestId('convert-paragraph')).toHaveClass(/is-active/);
});

test('用「+」在下方插入块后，手柄跟到新块', async ({ page }) => {
  await openDoc(page, SAMPLE);
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('doc-title')).toHaveText(/未打开文档|未命名/);

  const prose = activeProse(page);
  await prose.click();
  await page.keyboard.type('fdhdt');
  await page.keyboard.press('End');

  const box = await prose.locator('p').first().boundingBox();
  if (!box) throw new Error('应有段落');
  await page.mouse.move(box.x + 40, box.y + 10);
  await expect(paneTestId(page, 'block-handle')).toBeVisible();

  await paneTestId(page, 'block-add').click();
  await page.getByTestId('insert-h2').click();
  await expect(prose.locator('h2')).toHaveCount(1);

  // 鼠标不动：手柄应该跟着新插入的标题，而不是留在原来的段落上
  await page.waitForTimeout(200);
  const delta = await page.evaluate(() => {
    const heading = document.querySelector('[role="tabpanel"]:not([hidden]) .ProseMirror h2');
    const handle = document.querySelector('.block-handle');
    if (!heading || !handle) return 999;
    const range = document.createRange();
    range.selectNodeContents(heading);
    const line = range.getClientRects()[0];
    if (!line) return 999;
    const hr = handle.getBoundingClientRect();
    return Math.abs(hr.top + hr.height / 2 - (line.top + line.height / 2));
  });

  expect(delta).toBeLessThanOrEqual(1.5);
});

test('左侧手柄的菜单可以把段落转换成标题', async ({ page }) => {
  await openDoc(page, SAMPLE);
  const firstParagraph = activeProse(page).locator('p').first();
  const text = (await firstParagraph.textContent())?.slice(0, 6) ?? '';

  await firstParagraph.hover();
  await expect(paneTestId(page, 'block-handle')).toBeVisible();

  await paneTestId(page, 'block-ops').click();
  await expect(paneTestId(page, 'block-ops-menu')).toBeVisible();
  await page.getByTestId('convert-h2').click();

  const h2 = activeProse(page).locator('h2').filter({ hasText: text }).first();
  await expect(h2).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('已保存', { timeout: 20_000 });

  // 保存后重新打开，段落类型变更必须落在文件里
  await page.reload();
  await expect(page.getByTestId('doc-title')).toHaveText(SAMPLE);
  await expect(activeProse(page).locator('h2').filter({ hasText: text }).first()).toBeVisible();
});

test('含内嵌 HTML 的文档默认用源码模式打开，并原样保存', async ({ page }) => {
  await page.goto(`/?open=${encodeURIComponent(HTML_DOC)}`);
  await expect(page.getByTestId('doc-title')).toHaveText(HTML_DOC);

  await expect(page.getByTestId('banner-integrity')).toBeVisible();
  const textarea = paneTestId(page, 'source-textarea');
  await expect(textarea).toBeVisible();

  const original = await textarea.inputValue();
  expect(original).toContain('<div class="callout">');
  expect(original).toContain('</table>');

  await textarea.fill(`${original}\n追加的一行\n`);
  await expect(page.getByTestId('save-state')).toHaveText('已保存', { timeout: 20_000 });

  const stored = await readVirtualFile(page, '/demo/含内嵌HTML.md');
  expect(stored).toContain('<div class="callout">');
  expect(stored).toContain('追加的一行');
});

test('源码模式与可视化模式来回切换内容不丢失', async ({ page }) => {
  await openDoc(page, SAMPLE);

  await page.getByTestId('btn-mode').click();
  const textarea = paneTestId(page, 'source-textarea');
  await expect(textarea).toBeVisible();
  const markdown = await textarea.inputValue();
  expect(markdown).toContain('# airMD · 使用说明');
  // 表格可能被重新对齐（列宽补空格），只校验内容
  expect(markdown).toContain('可视化编辑');
  expect(markdown).toContain('零丢失的兜底路径');
  expect(markdown).toContain('![示例图片](assets/sample.png)');

  await page.getByTestId('btn-mode').click();
  await expect(activeProse(page)).toContainText('airMD · 使用说明');

  await page.getByTestId('btn-mode').click();
  const again = await paneTestId(page, 'source-textarea').inputValue();
  // 语义一致：控制符数量不应减少
  expect(again.match(/^#/gm)?.length ?? 0).toBeGreaterThanOrEqual((markdown.match(/^#/gm)?.length ?? 0));
});

test('斜杠菜单的方向键让高亮逐行下移，越过中线后列表才跟随', async ({ page }) => {
  await openDoc(page, SAMPLE);

  // 用空白新文档，保证 "/" 落在空段落开头
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('doc-title')).toHaveText(/未打开文档|未命名/);

  const prose = activeProse(page);
  await prose.click();
  await expect(prose).toBeFocused();
  await page.keyboard.type('/');
  await expect(activePane(page).locator('.milkdown-slash-menu[data-show="true"]')).toBeVisible();

  const menuState = () =>
    page.evaluate(() => {
      const menu = document.querySelector('[role="tabpanel"]:not([hidden]) .milkdown-slash-menu');
      const scroller = menu?.querySelector('.menu-groups');
      const hovered = menu?.querySelector('.menu-group li.hover');
      if (!scroller || !hovered) throw new Error('斜杠菜单结构变化');
      const box = scroller.getBoundingClientRect();
      const row = hovered.getBoundingClientRect();
      return {
        index: Number((hovered as HTMLElement).dataset.index),
        scrollTop: Math.round(scroller.scrollTop),
        rowHeight: Math.round(row.height),
        // 选中项中心相对容器中线的偏移：0 表示正居中
        offset: Math.round(row.top + row.height / 2 - (box.top + box.height / 2)),
      };
    });

  const first = await menuState();
  expect(first.index).toBe(0);

  // 第一下：高亮往下走，列表不能跟着滚（旧实现会把它立刻顶到顶部）
  await page.keyboard.press('ArrowDown');
  const second = await menuState();
  expect(second.index).toBe(1);
  expect(second.scrollTop).toBe(first.scrollTop);
  expect(second.offset).toBeGreaterThan(first.offset);

  // 继续按到越过中线：列表开始跟随，选中项停在中线附近
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(40);
  }
  const far = await menuState();
  expect(far.index).toBe(6);
  expect(far.scrollTop).toBeGreaterThan(first.scrollTop);
  expect(Math.abs(far.offset)).toBeLessThanOrEqual(far.rowHeight / 2 + 1);
});

test('标题块首按退格直接变回正文，不再逐级降级', async ({ page }) => {
  await openDoc(page, SAMPLE);
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('doc-title')).toHaveText(/未打开文档|未命名/);

  const prose = activeProse(page);
  await prose.click();
  await expect(prose).toBeFocused();

  // 斜杠菜单里选「标题 5」（菜单顺序：正文 / 标题 1-6 / 引用 / 分隔线）
  await page.keyboard.type('/');
  await expect(activePane(page).locator('.milkdown-slash-menu[data-show="true"]')).toBeVisible();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(prose.locator('h5')).toHaveCount(1);

  await page.keyboard.type('五级标题');
  await expect(prose.locator('h5')).toHaveText('五级标题');

  // 光标在标题开头按退格：一次到位回正文，而不是 H5 → H4
  await page.keyboard.press('Home');
  await page.waitForTimeout(120);
  await page.keyboard.press('Backspace');

  await expect(prose.locator('h5')).toHaveCount(0);
  const firstBlock = prose.locator('p').first();
  await expect(firstBlock).toHaveText('五级标题');
  // 回正文后不应被额外包一层加粗
  await expect(firstBlock.locator('strong')).toHaveCount(0);
});

test('源码模式往返：没改动就复用编辑器实例，改过才重建', async ({ page }) => {
  await openDoc(page, SAMPLE);
  // 给当前的 ProseMirror 打个记号，用来判断实例是否被重建
  await page.evaluate(() => {
    document.querySelector('[role="tabpanel"]:not([hidden]) .ProseMirror')?.setAttribute('data-instance', 'keep');
  });

  await page.getByTestId('btn-mode').click();
  await expect(paneTestId(page, 'source-textarea')).toBeVisible();
  await page.getByTestId('btn-mode').click();
  await expect(activeProse(page)).toBeVisible();
  // 只是切了个模式，实例应该原样保留
  await expect(activeProse(page)).toHaveAttribute('data-instance', 'keep');
  await expect(activeProse(page)).toContainText('airMD · 使用说明');

  // 源码里改了内容，切回来必须重建并体现改动
  await page.getByTestId('btn-mode').click();
  await paneTestId(page, 'source-textarea').fill('# 改过的标题\n\n新正文。\n');
  await page.getByTestId('btn-mode').click();
  await expect(activeProse(page).locator('h1')).toHaveText('改过的标题');
  await expect(activeProse(page)).not.toHaveAttribute('data-instance', 'keep');
});

test('引用里的空行按退格会离开引用，而不是并到上一行', async ({ page }) => {
  await openDoc(page, SAMPLE);

  // 用源码模式造一个「引用里有两段」的文档
  await page.getByTestId('btn-mode').click();
  await paneTestId(page, 'source-textarea').fill('> dfaewdfaewfd\n>\n> 第二行\n');
  await page.getByTestId('btn-mode').click();
  const prose = activeProse(page);
  await expect(prose.locator('blockquote p')).toHaveCount(2);

  // 清空第二段 → 引用里留下一个空段落
  await prose.locator('blockquote p').nth(1).click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await expect(prose.locator('blockquote p')).toHaveCount(2);
  await expect(prose.locator('blockquote p').nth(1)).toHaveText('');

  // 关键：块首退格应该让空行离开引用，而不是并入上一行
  await page.keyboard.press('Backspace');
  await expect(prose.locator('blockquote p')).toHaveCount(1);
  await expect(prose.locator('blockquote')).toHaveText('dfaewdfaewfd');

  // 光标落在引用外的普通段落里，能继续正常输入
  await page.keyboard.type('正文');
  await expect(prose.locator('blockquote')).toHaveText('dfaewdfaewfd');
  await expect(prose.locator(':scope > p').filter({ hasText: '正文' })).toHaveCount(1);
});

test('右侧大纲列出标题，点击可跳转，源码模式下隐藏', async ({ page }) => {
  await openDoc(page, SAMPLE);

  // 造一篇有 10 个小节的长文，保证能滚动
  await page.getByTestId('btn-mode').click();
  const long = Array.from(
    { length: 10 },
    (_, i) => `## 第 ${i + 1} 节\n\n${'内容填充内容填充内容填充。\n'.repeat(8)}`,
  ).join('\n');
  await paneTestId(page, 'source-textarea').fill(long);
  await page.getByTestId('btn-mode').click();
  await expect(activeProse(page)).toBeVisible();

  const items = page.locator('[data-testid="outline-item"]');
  await expect(items).toHaveCount(10);
  await expect(items.first()).toHaveText('第 1 节');

  // 点击靠后的标题：滚动 + 高亮
  await items.nth(7).click();
  await expect(items.nth(7)).toHaveClass(/is-active/);
  const scrollTop = await page.evaluate(
    () => document.querySelector('[data-testid="editor-scroll"]')?.scrollTop ?? 0,
  );
  expect(scrollTop).toBeGreaterThan(0);

  // 源码模式下不显示大纲
  await page.getByTestId('btn-mode').click();
  await expect(paneTestId(page, 'outline')).toHaveCount(0);
});

test('正文字号走统一基准，标题按比例跟着放大', async ({ page }) => {
  await openDoc(page, SAMPLE);

  const sizes = await page.evaluate(() => {
    const p = document.querySelector('[role="tabpanel"]:not([hidden]) .ProseMirror p');
    const h1 = document.querySelector('[role="tabpanel"]:not([hidden]) .ProseMirror h1');
    if (!p || !h1) return null;
    return {
      body: Number.parseFloat(getComputedStyle(p).fontSize),
      h1: Number.parseFloat(getComputedStyle(h1).fontSize),
    };
  });

  expect(sizes?.body).toBeCloseTo(16.5, 1);
  // 标题跟着基准一起放大（h1 约 1.8 倍）
  expect(sizes?.h1).toBeGreaterThan((sizes?.body ?? 0) * 1.7);
});

test('待办复选框跟着正文字号放大，且与首行垂直居中', async ({ page }) => {
  await openDoc(page, SAMPLE);

  const probe = () =>
    page.evaluate(() => {
      const item = Array.from(document.querySelectorAll('.milkdown-list-item-block')).find((el) =>
        el.textContent?.includes('还没做的待办'),
      );
      const svg = item?.querySelector('.label-wrapper svg');
      const p = item?.querySelector('.children p');
      if (!svg || !p) return null;
      const center = (el: Element) => {
        const rect = el.getBoundingClientRect();
        return rect.top + rect.height / 2;
      };
      return {
        size: Number.parseFloat(getComputedStyle(svg).width),
        centerDelta: Math.abs(center(svg) - center(p)),
      };
    });

  const before = await probe();
  expect(before?.size).toBeCloseTo(16, 0);
  // 复选框中心与首行中心对齐（不能悬在文字上方）
  expect(before?.centerDelta ?? 99).toBeLessThan(1);

  await page.getByTestId('btn-font-size').click();
  await page.getByTestId('font-preset-20.5').click();
  await page.keyboard.press('Escape');

  const after = await probe();
  // 20.5 / 16.5 ≈ 1.24，复选框跟着涨，而不是停在 16px
  expect(after?.size).toBeGreaterThan((before?.size ?? 0) * 1.2);
  expect(after?.centerDelta ?? 99).toBeLessThan(1);
});

test('工具栏可调整正文字号，快捷键复位，刷新后记住选择', async ({ page }) => {
  await openDoc(page, SAMPLE);

  const bodySize = () =>
    page.evaluate(() => {
      const p = document.querySelector('[role="tabpanel"]:not([hidden]) .ProseMirror p');
      return p ? Number.parseFloat(getComputedStyle(p).fontSize) : 0;
    });

  expect(await bodySize()).toBeCloseTo(16.5, 1);

  // 工具栏入口：显示当前字号 + 面板里的档位
  await page.getByTestId('btn-font-size').click();
  await expect(page.getByTestId('font-panel')).toBeVisible();
  await expect(page.getByTestId('font-size-value')).toHaveText('16.5 px');

  await page.getByTestId('font-size-inc').click();
  await expect(page.getByTestId('font-size-value')).toHaveText('17 px');
  expect(await bodySize()).toBeCloseTo(17, 1);

  // 预设档位：正文与标题都按新基准缩放
  await page.getByTestId('font-preset-20.5').click();
  expect(await bodySize()).toBeCloseTo(20.5, 1);
  const h1 = await page.evaluate(() => {
    const el = document.querySelector('[role="tabpanel"]:not([hidden]) .ProseMirror h1');
    return el ? Number.parseFloat(getComputedStyle(el).fontSize) : 0;
  });
  expect(h1).toBeGreaterThan(20.5 * 1.7);

  // 快捷键：光标在正文里也要生效 —— Ctrl+0 回到默认，Ctrl+= 放大一档
  await page.keyboard.press('Escape');
  await activeProse(page).locator('p').first().click();
  await expect(activeProse(page)).toBeFocused();
  await page.keyboard.press('Control+0');
  expect(await bodySize()).toBeCloseTo(16.5, 1);
  await page.keyboard.press('Control+Equal');
  expect(await bodySize()).toBeCloseTo(17, 1);

  // 字号是全局偏好：刷新后仍然生效
  await page.reload();
  await expect(page.getByTestId('doc-title')).toHaveText(SAMPLE);
  await expect(activeProse(page)).toBeVisible();
  expect(await bodySize()).toBeCloseTo(17, 1);
});

test('检测到外部修改后自动重新载入磁盘内容', async ({ page }) => {
  await openDoc(page, SAMPLE);
  await expect(activeProse(page)).toContainText('airMD · 使用说明');

  // 模拟其它程序在磁盘上改写了文件（内容 + mtime 同时变化）
  await page.evaluate(() => {
    const key = 'airmd.vfs:/demo/示例文档.md';
    const entry = JSON.parse(localStorage.getItem(key) as string);
    const content = '# 外部修改\n\n这一行来自其它程序。\n';
    entry.base64 = btoa(String.fromCharCode(...new TextEncoder().encode(content)));
    entry.mtimeMs = Date.now() + 10_000;
    localStorage.setItem(key, JSON.stringify(entry));
  });

  await expect(activeProse(page)).toContainText('这一行来自其它程序。', { timeout: 15_000 });
});

test('表格里 Ctrl+A 逐级全选，退格只清表格内容不会清空整篇文档', async ({ page }) => {
  await openDoc(page, SAMPLE);

  const table = activePane(page).locator('.milkdown-table-block table:visible').first();
  await table.scrollIntoViewIfNeeded();
  await table.locator('tr').nth(1).locator('td').first().click();
  await expect(activeProse(page)).toBeFocused();

  const words = async () =>
    Number.parseInt((await page.getByTestId('status-count').textContent()) ?? '0', 10);
  const before = await words();
  expect(before).toBeGreaterThan(0);

  // 第一次 Ctrl+A：选中整张表的单元格（而不是整篇文档）
  await page.keyboard.press('Control+a');
  await expect(activePane(page).locator('.selectedCell').first()).toBeVisible();
  expect(await words()).toBe(before);

  // 按退格：只清空表格内容，正文必须还在
  await page.keyboard.press('Backspace');
  await expect(activeProse(page)).toContainText('airMD · 使用说明');
  expect(await words()).toBeGreaterThan(0);

  // 再全选一次 → 选中表格节点；再全选一次才轮到整篇文档
  await table.locator('tr').nth(1).locator('td').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+a');
  expect(await activePane(page).locator('.selectedCell').count()).toBe(0);
});

test('表格右键菜单可以选中整行、删除行、插列、清内容、删除整表', async ({ page }) => {
  await openDoc(page, SAMPLE);

  const table = activePane(page).locator('.milkdown-table-block table:visible').first();
  await table.scrollIntoViewIfNeeded();
  const rows = () => table.locator('tr').count();
  const rowCount = await rows();

  const openMenu = async (row: number) => {
    await table.locator('tr').nth(row).locator('td').first().click({ button: 'right' });
    await expect(paneTestId(page, 'table-menu')).toBeVisible();
  };

  // 选中整行
  await openMenu(1);
  await page.getByTestId('table-menu-select-row').click();
  expect(await activePane(page).locator('.selectedCell').count()).toBeGreaterThan(0);
  await expect(page.getByTestId('table-menu-pos')).toContainText('已选 1 行');

  // 删除这一行
  await page.getByTestId('table-menu-remove-row').click();
  await expect(paneTestId(page, 'table-menu')).toHaveCount(0);
  expect(await rows()).toBe(rowCount - 1);

  // 右侧插入一列
  const cols = await table.locator('tr').first().locator('td, th').count();
  await openMenu(1);
  await page.getByTestId('table-menu-col-after').click();
  expect(await table.locator('tr').first().locator('td, th').count()).toBe(cols + 1);

  // 选中整列 → 清除内容（结构还在）
  await openMenu(1);
  await page.getByTestId('table-menu-select-col').click();
  await openMenu(1);
  await page.getByTestId('table-menu-clear').click();
  await expect(table).toBeVisible();
  expect(await rows()).toBe(rowCount - 1);

  // 删除整张表：表格消失，正文仍在
  await table.locator('tr').first().locator('td, th').first().click({ button: 'right' });
  await page.getByTestId('table-menu-remove-table').click();
  await expect(activePane(page).locator('.milkdown-table-block')).toHaveCount(0);
  await expect(activeProse(page)).toContainText('airMD · 使用说明');
});

test('工具栏插入的表格结构合法，块首退格只会选中表格、再退格才删除', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByTestId('btn-new').click();
  await expect(activeProse(page)).toBeVisible();

  await page.getByTestId('tb-table').click();
  const table = activePane(page).locator('.milkdown-table-block table:visible').first();
  await expect(table).toBeVisible();

  await table.locator('th').first().click();

  // 第一次退格：只把表格选中，不删除也不报错
  await page.keyboard.press('Backspace');
  await expect(activePane(page).locator('.milkdown-table-block')).toHaveCount(1);

  // 第二次退格：删除整张表，文档退化成空段落但依然可编辑
  await page.keyboard.press('Backspace');
  await expect(activePane(page).locator('.milkdown-table-block')).toHaveCount(0);
  await page.keyboard.type('还能继续写');
  await expect(activeProse(page)).toContainText('还能继续写');

  // 之前这里会抛 "Called contentMatchAt on a node with invalid content"，之后编辑器彻底失效
  expect(pageErrors).toEqual([]);
});

test('块菜单：普通块不再有复制/上移/下移，表格块换成表格操作', async ({ page }) => {
  await openDoc(page, SAMPLE);

  // 普通段落：只剩「转换为 / 列表 / 删除此块」
  const paragraph = activeProse(page).locator(':scope > p').nth(1);
  await paragraph.hover();
  await paneTestId(page, 'block-ops').click();
  const menu = paneTestId(page, 'block-ops-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('删除此块');
  await expect(menu).not.toContainText('复制此块');
  await expect(page.getByTestId('block-move-up')).toHaveCount(0);
  await expect(page.getByTestId('block-move-down')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 表格块：同一个入口换成表格操作，按指针所在单元格定位
  const table = activePane(page).locator('.milkdown-table-block table:visible').first();
  await table.scrollIntoViewIfNeeded();
  await table.locator('tr').nth(1).locator('td').nth(1).hover();
  await paneTestId(page, 'block-ops').click();
  await expect(page.getByTestId('block-table-head')).toContainText('第 2 行');

  const colsBefore = await table.locator('tr').first().locator('td, th').count();
  await page.getByTestId('block-table-col-after').click();
  await expect(table.locator('tr').first().locator('td, th')).toHaveCount(colsBefore + 1);
});
