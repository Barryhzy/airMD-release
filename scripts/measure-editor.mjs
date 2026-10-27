// Instrument a separate production build; normal application builds contain no probes.
import { build, preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/measure-editor.mjs <results.json>');
const directory = await mkdtemp(join(tmpdir(), 'airmd-performance-'));
const probe = (name) => `window.__airmdPerf.count('${name}');`;
const replacements = [
  ['/src/ui/App.tsx', 'export function App() {', `export function App() { ${probe('appRenders')}`],
  ['/src/ui/ProjectSidebar.tsx', 'memo(function ProjectSidebar({ controller, currentPath, onOpenFile }: Props) {',
    `memo(function ProjectSidebar({ controller, currentPath, onOpenFile }: Props) { ${probe('projectRenders')}`],
  ['/src/core/fs/browserFs.ts', 'async scanProject(root) {', `async scanProject(root) { ${probe('projectScans')}`],
  ['/src/core/project/tree.ts', 'export function buildProjectTree(files: ProjectFile[]): ProjectNode[] {',
    `export function buildProjectTree(files: ProjectFile[]): ProjectNode[] { ${probe('projectTreeBuilds')}`],
  ['/src/ui/Outline.tsx', 'function collectHeadings(editor: Editor | null): OutlineItem[] {',
    `function collectHeadings(editor: Editor | null): OutlineItem[] { ${probe('outlineScans')}`],
  ['/src/ui/BlockHandle.tsx', 'const containerRect = container.getBoundingClientRect();',
    `${probe('handleMeasures')} const containerRect = container.getBoundingClientRect();`],
  ['/src/ui/BlockHandle.tsx', 'const rect = node.getBoundingClientRect();',
    `${probe('handleChecks')} const rect = node.getBoundingClientRect();`],
  ['/src/core/doc/DocumentController.ts', '#set(patch: Partial<DocumentSnapshot>): void {',
    `#set(patch: Partial<DocumentSnapshot>): void { ${probe('documentNotifications')}`],
  ['/src/core/editor/createCrepe.ts', 'return handle.crepe.getMarkdown();',
    "return window.__airmdPerf.measure('readMarkdown', () => handle.crepe.getMarkdown());"],
  ['/@milkdown/plugin-listener/lib/index.js', 'const markdown = serializer(doc);',
    "const markdown = window.__airmdPerf.measure('listenerMarkdown', () => serializer(doc));"],
];
let server;
let browser;
try {
  await build({ logLevel: 'warn', build: { outDir: directory, emptyOutDir: true }, plugins: [{
    name: 'editor-performance-probes', enforce: 'pre',
    transform(source, id) {
      for (const [suffix, before, after] of replacements) {
        if (!id.endsWith(suffix)) continue;
        if (!source.includes(before)) throw new Error(`Probe missing: ${suffix}: ${before}`);
        source = source.replace(before, after);
      }
      return source;
    },
  }] });
  server = await preview({ build: { outDir: directory }, preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    window.__airmdPerf = {
      values: {},
      count(name) { this.values[name] = (this.values[name] ?? 0) + 1; },
      measure(name, fn) {
        this.count(name);
        const start = performance.now();
        try { return fn(); } finally {
          this.values[`${name}Ms`] = (this.values[`${name}Ms`] ?? 0) + performance.now() - start;
        }
      },
    };
  });
  const markdown = Array.from({ length: 240 }, (_, i) =>
    `## 第 ${i} 节\n\n${Array.from({ length: 4 }, () => '长文档性能测量，正文包含普通文字和 **加粗片段**。'.repeat(6)).join('\n\n')}\n\n`).join('');
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
  const sample = async (action) => {
    await page.evaluate(() => { window.__airmdPerf.values = {}; });
    const before = await metrics();
    const latencies = [];
    await action(latencies);
    await page.waitForTimeout(1400);
    const after = await metrics();
    const counts = await page.evaluate(() => window.__airmdPerf.values);
    latencies.sort((a, b) => a - b);
    return { ...counts, scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      keyToFrameMedianMs: latencies[Math.floor(latencies.length / 2)],
      keyToFrameP95Ms: latencies[Math.floor(latencies.length * 0.95)] };
  };
  const press = async (key, latencies) => {
    const start = performance.now();
    await page.keyboard.press(key);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    latencies.push(performance.now() - start);
  };
  const trials = [];
  for (let trial = 0; trial < 3; trial++) {
    await page.goto('http://127.0.0.1:4175');
    await page.evaluate((text) => {
      localStorage.clear();
      const bytes = new TextEncoder().encode(text);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      localStorage.setItem('airmd.vfs:/demo/示例文档.md', JSON.stringify({ base64: btoa(binary), mtimeMs: Date.now() }));
    }, markdown);
    await page.goto('http://127.0.0.1:4175/?open=' + encodeURIComponent('示例文档.md'));
    await expect(page.getByTestId('outline-item')).toHaveCount(240, { timeout: 30000 });
    if (process.argv.includes('--project')) {
      await page.getByTestId('btn-open-folder').click();
      await expect(page.getByTestId('project-sidebar')).toBeVisible();
    }
    const paragraph = page.locator('.ProseMirror > p').nth(480);
    await paragraph.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await paragraph.click();
    await page.keyboard.press('Home');
    await paragraph.hover();
    await expect(page.getByTestId('block-handle')).toBeVisible();
    await page.waitForTimeout(1500);
    const cursor = await sample(async (latencies) => {
      for (let group = 0; group < 3; group++) {
        for (let i = 0; i < 10; i++) await press(i % 2 ? 'ArrowLeft' : 'ArrowRight', latencies);
        await page.waitForTimeout(300);
      }
    });
    const typing = await sample(async (latencies) => {
      for (let i = 0; i < 10; i++) {
        await press('x', latencies);
        await page.waitForTimeout(300);
      }
    });
    await expect(page.getByTestId('save-state')).toHaveText('已保存');
    trials.push({ cursor, typing });
  }
  const result = { browser: await browser.version(), platform: process.platform,
    characters: markdown.length, headings: 240, blocks: 1200,
    scenario: '30 cursor moves in 3 groups; 10 edits 300ms apart; autosave enabled; 3 trials', projectOpen: process.argv.includes('--project'), trials };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes('--check')) {
    for (const { cursor, typing } of trials) {
      for (const key of ['documentNotifications', 'appRenders', 'outlineScans', 'handleChecks', 'handleMeasures', 'readMarkdown', 'listenerMarkdown', 'projectRenders', 'projectScans', 'projectTreeBuilds']) {
        expect(cursor[key] ?? 0, `cursor: ${key}`).toBe(0);
      }
      expect(typing.readMarkdown ?? 0, 'reuse listener Markdown').toBe(0);
      expect(typing.listenerMarkdown, 'serialize each edit once').toBe(10);
      expect(typing.outlineScans, 'scan content changes only').toBeLessThanOrEqual(10);
      expect(typing.appRenders, 'content and save state updates only').toBeLessThanOrEqual(13);
      for (const key of ['projectRenders', 'projectScans', 'projectTreeBuilds']) expect(typing[key] ?? 0, `typing: ${key}`).toBe(0);
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server ? server.httpServer.close(resolve) : resolve());
  await rm(directory, { recursive: true, force: true });
}
