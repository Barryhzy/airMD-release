import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 这些用例只关心「字节 ⇄ 文本 ⇄ 保存」的链路，不需要真实的编辑器
vi.mock('../../src/core/editor/createCrepe', () => ({
  createCrepeEditor: vi.fn(async () => {
    throw new Error('本用例不应创建编辑器');
  }),
  readMarkdown: vi.fn(() => ''),
}));

import { DocumentController } from '../../src/core/doc/DocumentController';
import type { FileStat, FsAdapter } from '../../src/core/fs/types';

interface FakeFile {
  bytes: Uint8Array;
  mtimeMs: number;
  readonly?: boolean;
}

function createFakeFs(initial: Record<string, FakeFile>) {
  const files = new Map(Object.entries(initial));
  let clock = 1_000;

  const fs: FsAdapter = {
    kind: 'browser',
    nativeDialogs: false,
    async openDialog() {
      return null;
    },
    async openFolderDialog() { return null; },
    async scanProject(root) { return { root, files: [], warnings: [], scannedDirectories: 0, elapsedMs: 0 }; },
    async saveDialog(path) {
      return `${path ?? 'untitled'}-saved.md`;
    },
    async readFile(path) {
      const file = files.get(path);
      if (!file) throw new Error(`not found: ${path}`);
      return file.bytes;
    },
    async writeFile(path, bytes) {
      clock += 1;
      files.set(path, { bytes: new Uint8Array(bytes), mtimeMs: clock });
    },
    async stat(path): Promise<FileStat> {
      const file = files.get(path);
      if (!file) return { exists: false, size: 0, mtimeMs: 0, readonly: false };
      return {
        exists: true,
        size: file.bytes.byteLength,
        mtimeMs: file.mtimeMs,
        readonly: Boolean(file.readonly),
      };
    },
    async exists(path) {
      return files.has(path);
    },
    async sameFile(left, right) {
      const normalize = (path: string) => /^[a-z]:/i.test(path) ? path.replace(/\\/g, '/').toLowerCase() : path;
      return normalize(left) === normalize(right);
    },
    async readImageAsDataUrl() {
      return 'data:image/png;base64,AA==';
    },
    async writeAttachment(dir, name, bytes) {
      const path = `${dir}/${name}`;
      clock += 1;
      files.set(path, { bytes, mtimeMs: clock });
      return path;
    },
    async listDir() {
      return [];
    },
    async ensureDir() {},
    async revealInFileManager() {},
  };

  return {
    fs,
    files,
    /** 模拟外部程序改动 */
    touch(path: string, bytes: Uint8Array) {
      clock += 10;
      files.set(path, { bytes, mtimeMs: clock });
    },
    readText(path: string) {
      const file = files.get(path);
      return file ? new TextDecoder().decode(file.bytes) : '';
    },
    raw(path: string) {
      return files.get(path)?.bytes ?? new Uint8Array();
    },
  };
}

const encoder = new TextEncoder();

function withBom(text: string): Uint8Array {
  const body = encoder.encode(text);
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

describe('DocumentController 端到端（无编辑器）', () => {
  let controller: DocumentController;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(async () => {
    await controller?.dispose();
    vi.useRealTimers();
  });

  it('含 HTML 的 CRLF 文档以源码模式打开，并保留换行与 BOM', async () => {
    const path = '/docs/crlf.md';
    const original = '# 标题\r\n\r\n<div>块</div>\r\n\r\n正文\r\n';
    const fake = createFakeFs({ [path]: { bytes: withBom(original), mtimeMs: 1 } });

    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath(path);

    const state = controller.getSnapshot();
    expect(state.status).toBe('ready');
    expect(state.mode).toBe('source');
    expect(state.meta?.encoding).toBe('utf-8-bom');
    expect(state.meta?.eol).toBe('\r\n');
    expect(state.meta?.trailingNewlines).toBe(1);
    expect(controller.getText()).toBe(original);

    // 编辑并保存
    controller.handleSourceChange(original.replace('正文', '改过的正文'));
    expect(controller.getSnapshot().dirty).toBe(true);
    await expect(controller.save()).resolves.toBe(true);

    const written = fake.raw(path);
    expect(Array.from(written.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    // TextDecoder 默认会吃掉 BOM，所以这里直接比对正文
    expect(fake.readText(path)).toBe('# 标题\r\n\r\n<div>块</div>\r\n\r\n改过的正文\r\n');
    expect(fake.raw(path).byteLength).toBe(3 + encoder.encode('# 标题\r\n\r\n<div>块</div>\r\n\r\n改过的正文\r\n').byteLength);
    expect(controller.getSnapshot().dirty).toBe(false);
  });

  it('没有末尾换行的文件，保存后也不会凭空多出换行', async () => {
    const path = '/docs/nonl.md';
    const original = '<div>x</div>\n没有末尾换行';
    const fake = createFakeFs({ [path]: { bytes: encoder.encode(original), mtimeMs: 1 } });

    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath(path);
    expect(controller.getSnapshot().meta?.trailingNewlines).toBe(0);

    controller.handleSourceChange(`${original}\n追加`);
    await controller.save();

    expect(fake.readText(path)).toBe(`${original}\n追加`);
  });

  it('检测到外部修改：无本地改动时自动跟随磁盘', async () => {
    const path = '/docs/a.md';
    const fake = createFakeFs({ [path]: { bytes: encoder.encode('# A\n'), mtimeMs: 1 } });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath(path);

    fake.touch(path, encoder.encode('# A 被外部改了\n'));
    await controller.checkExternal();

    expect(controller.getSnapshot().conflict).toBeNull();
    expect(controller.getText()).toContain('被外部改了');
  });

  it('检测到外部修改：有本地改动时进入冲突状态并暂停自动保存', async () => {
    const path = '/docs/b.md';
    const fake = createFakeFs({ [path]: { bytes: encoder.encode('# B\n'), mtimeMs: 1 } });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath(path);

    controller.handleSourceChange('# B 本地改动\n');
    fake.touch(path, encoder.encode('# B 外部改动\n'));
    await controller.checkExternal();

    const state = controller.getSnapshot();
    expect(state.conflict).not.toBeNull();
    // 磁盘内容没有被覆盖
    expect(fake.readText(path)).toContain('外部改动');
  });

  it('冲突后选择「用我的内容覆盖」才写入磁盘', async () => {
    const path = '/docs/c.md';
    const fake = createFakeFs({ [path]: { bytes: encoder.encode('# C\n'), mtimeMs: 1 } });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath(path);

    controller.handleSourceChange('# C 本地\n');
    fake.touch(path, encoder.encode('# C 外部\n'));
    await controller.checkExternal();
    expect(controller.getSnapshot().conflict).not.toBeNull();

    await controller.resolveConflict('overwrite');
    expect(fake.readText(path)).toContain('本地');
    expect(controller.getSnapshot().conflict).toBeNull();
  });

  it('只读文件不会被自动覆盖', async () => {
    const path = '/docs/ro.md';
    const fake = createFakeFs({
      [path]: { bytes: encoder.encode('# RO\n'), mtimeMs: 1, readonly: true },
    });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath(path);
    expect(controller.getSnapshot().readonly).toBe(true);

    controller.handleSourceChange('# RO 改过\n');
    await controller.flush();
    expect(fake.readText(path)).toBe('# RO\n');
  });

  it('切换文件前完成待执行的自动保存', async () => {
    const fake = createFakeFs({
      '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 },
      '/b.md': { bytes: encoder.encode('<div>B</div>'), mtimeMs: 2 },
    });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath('/a.md');
    controller.handleSourceChange('<div>A edited</div>');
    await controller.openPath('/b.md');
    expect(fake.readText('/a.md')).toBe('<div>A edited</div>');
    expect(controller.getSnapshot().path).toBe('/b.md');
  });

  it('关闭自动保存后取消切换会保留当前内容，明确放弃后才切换', async () => {
    const fake = createFakeFs({
      '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 },
      '/b.md': { bytes: encoder.encode('<div>B</div>'), mtimeMs: 2 },
    });
    const confirmUnsaved = vi.fn().mockResolvedValueOnce('cancel').mockResolvedValueOnce('discard');
    controller = new DocumentController({ fs: fake.fs, confirmUnsaved });
    await controller.openPath('/a.md');
    controller.setAutoSave(false);
    controller.handleSourceChange('<div>unsaved</div>');
    await controller.openPath('/b.md');
    expect(controller.getSnapshot().path).toBe('/a.md');
    expect(controller.getText()).toContain('unsaved');
    expect(controller.getSnapshot().dirty).toBe(true);
    await controller.openPath('/b.md');
    expect(controller.getSnapshot().path).toBe('/b.md');
    expect(fake.readText('/a.md')).toBe('<div>A</div>');
  });

  it('未命名文档选择保存后才允许新建，取消另存为则保留原稿', async () => {
    const fake = createFakeFs({});
    const saveDialog = vi.spyOn(fake.fs, 'saveDialog').mockResolvedValueOnce(null).mockResolvedValueOnce('/draft.md');
    controller = new DocumentController({ fs: fake.fs, confirmUnsaved: async () => 'save' });
    await controller.newDocument();
    controller.handleSourceChange('draft');
    await controller.newDocument();
    expect(controller.getText()).toBe('draft');
    expect(controller.getSnapshot().dirty).toBe(true);
    await controller.newDocument();
    expect(fake.readText('/draft.md')).toBe('draft');
    expect(controller.getText()).toBe('');
    expect(saveDialog).toHaveBeenCalledTimes(2);
  });

  it('没有确认交互时不会静默丢弃未保存文档', async () => {
    const fake = createFakeFs({});
    controller = new DocumentController({ fs: fake.fs });
    await controller.newDocument();
    controller.handleSourceChange('draft');
    await controller.newDocument();
    expect(controller.getText()).toBe('draft');
  });

  it('保存失败后选择保存不能离开当前文档', async () => {
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 } });
    vi.spyOn(fake.fs, 'writeFile').mockRejectedValue(new Error('disk full'));
    controller = new DocumentController({ fs: fake.fs, confirmUnsaved: async () => 'save' });
    await controller.openPath('/a.md');
    controller.handleSourceChange('<div>unsaved</div>');
    await controller.newDocument();
    expect(controller.getSnapshot().path).toBe('/a.md');
    expect(controller.getSnapshot().dirty).toBe(true);
    expect(controller.getText()).toContain('unsaved');
  });

  it.each(['save', 'saveAs'] as const)('%s 期间的新输入保留为未保存内容，并在之后自动保存', async (method) => {
    vi.useFakeTimers();
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 } });
    controller = new DocumentController({ fs: fake.fs, autoSaveDelay: 20 });
    await controller.openPath('/a.md');
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const write = fake.fs.writeFile;
    vi.spyOn(fake.fs, 'writeFile').mockImplementationOnce(async (path, bytes) => {
      entered();
      await gate;
      await write(path, bytes);
    });
    controller.handleSourceChange('<div>first</div>');
    const pending = controller[method]();
    await writing;
    controller.handleSourceChange('<div>latest</div>');
    release();
    expect(await pending).toBe(true);
    expect(controller.getText()).toBe('<div>latest</div>');
    expect(controller.getSnapshot().dirty).toBe(true);
    const target = controller.getSnapshot().path!;
    expect(fake.readText(target)).toBe('<div>first</div>');
    await vi.advanceTimersByTimeAsync(25);
    expect(fake.readText(target)).toBe('<div>latest</div>');
    expect(controller.getSnapshot().dirty).toBe(false);
  });

  it('保存中的文件在完成写入后才切换，旧保存不会污染新文档', async () => {
    const fake = createFakeFs({
      '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 },
      '/b.md': { bytes: encoder.encode('<div>B</div>'), mtimeMs: 2 },
    });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath('/a.md');
    const write = fake.fs.writeFile;
    let release!: () => void;
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(fake.fs, 'writeFile').mockImplementationOnce(async (path, bytes) => {
      entered(); await gate; await write(path, bytes);
    });
    controller.handleSourceChange('<div>saved A</div>');
    const saving = controller.save();
    await writing;
    const opening = controller.openPath('/b.md');
    expect(controller.getSnapshot().path).toBe('/a.md');
    release();
    await Promise.all([saving, opening]);
    expect(controller.getSnapshot().path).toBe('/b.md');
    expect(controller.getText()).toBe('<div>B</div>');
    expect(fake.readText('/a.md')).toBe('<div>saved A</div>');
  });

  it('连续保存串行执行，后一次保存包含期间新增的内容', async () => {
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 } });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath('/a.md');
    let release!: () => void;
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const write = fake.fs.writeFile;
    let activeWrites = 0;
    let maxWrites = 0;
    const spy = vi.spyOn(fake.fs, 'writeFile').mockImplementation(async (path, bytes) => {
      activeWrites++;
      maxWrites = Math.max(maxWrites, activeWrites);
      entered();
      await gate;
      await write(path, bytes);
      activeWrites--;
    });
    controller.handleSourceChange('<div>first</div>');
    const first = controller.save();
    await writing;
    controller.handleSourceChange('<div>latest</div>');
    const second = controller.save();
    release();
    await Promise.all([first, second]);
    expect(maxWrites).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(fake.readText('/a.md')).toBe('<div>latest</div>');
  });

  it('手动保存拒绝将 GB18030 原文件改写成 UTF-8，另存新文件才转换', async () => {
    const original = new Uint8Array([...encoder.encode('<div>'), 0xd6, 0xd0, 0xce, 0xc4, ...encoder.encode('</div>')]);
    const fake = createFakeFs({ '/a.md': { bytes: original, mtimeMs: 1 } });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath('/a.md');
    controller.handleSourceChange('<div>中文 edited</div>');
    expect(await controller.save()).toBe(false);
    expect(fake.raw('/a.md')).toEqual(original);
    expect(controller.getSnapshot().dirty).toBe(true);
    expect(await controller.saveAs()).toBe(true);
    expect(controller.getSnapshot().meta?.encoding).toBe('utf-8');
    expect(fake.raw('/a.md')).toEqual(original);
    expect(fake.readText(controller.getSnapshot().path!)).toContain('中文 edited');
  });

  it('另存为选择原路径也不能绕过编码保护', async () => {
    const original = new Uint8Array([...encoder.encode('<div>'), 0xd6, 0xd0, ...encoder.encode('</div>')]);
    const fake = createFakeFs({ 'C:\\docs\\a.md': { bytes: original, mtimeMs: 1 } });
    vi.spyOn(fake.fs, 'saveDialog').mockResolvedValue('c:/DOCS/a.md');
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath('C:\\docs\\a.md');
    controller.handleSourceChange('<div>changed</div>');
    expect(await controller.saveAs()).toBe(false);
    expect(fake.files.size).toBe(1);
    expect(fake.raw('C:\\docs\\a.md')).toEqual(original);
  });

  it('手动保存也拒绝覆盖只读文件', async () => {
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1, readonly: true } });
    const write = vi.spyOn(fake.fs, 'writeFile');
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath('/a.md');
    controller.handleSourceChange('<div>changed</div>');
    expect(await controller.save()).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('冲突处理中取消另存为仍保留冲突状态和本地改动', async () => {
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 } });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath('/a.md');
    controller.handleSourceChange('<div>local</div>');
    fake.touch('/a.md', encoder.encode('<div>external</div>'));
    await controller.checkExternal();
    vi.spyOn(fake.fs, 'saveDialog').mockResolvedValue(null);
    await controller.resolveConflict('save-as');
    expect(controller.getSnapshot().conflict).not.toBeNull();
    expect(controller.getText()).toBe('<div>local</div>');
    expect(fake.readText('/a.md')).toBe('<div>external</div>');
  });

  it('明确选择重新载入冲突文件时放弃本地内容，不触发离开确认', async () => {
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 } });
    const confirmUnsaved = vi.fn().mockResolvedValue('cancel');
    controller = new DocumentController({ fs: fake.fs, confirmUnsaved });
    await controller.openPath('/a.md');
    controller.handleSourceChange('<div>local</div>');
    fake.touch('/a.md', encoder.encode('<div>external</div>'));
    await controller.checkExternal();
    await controller.resolveConflict('reload');
    expect(controller.getText()).toBe('<div>external</div>');
    expect(confirmUnsaved).not.toHaveBeenCalled();
  });

  it('关闭时保存失败会留下文档，选择取消也不会关闭', async () => {
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 } });
    vi.spyOn(fake.fs, 'writeFile').mockRejectedValue(new Error('disk full'));
    const confirmUnsaved = vi.fn().mockResolvedValueOnce('save').mockResolvedValueOnce('cancel');
    controller = new DocumentController({ fs: fake.fs, confirmUnsaved });
    await controller.openPath('/a.md');
    controller.handleSourceChange('<div>draft</div>');
    expect(await controller.prepareToClose()).toBe(false);
    expect(await controller.prepareToClose()).toBe(false);
    expect(controller.getText()).toBe('<div>draft</div>');
    expect(controller.getSnapshot().dirty).toBe(true);
    expect(fake.readText('/a.md')).toBe('<div>A</div>');
  });

  it('文件在打开后变成只读，手动保存也不写入', async () => {
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 } });
    const write = vi.spyOn(fake.fs, 'writeFile');
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath('/a.md');
    fake.files.get('/a.md')!.readonly = true;
    controller.handleSourceChange('<div>changed</div>');
    expect(await controller.save()).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(controller.getSnapshot().readonly).toBe(true);
  });

  it('另存为不覆盖其他只读文件', async () => {
    const fake = createFakeFs({ '/readonly.md': { bytes: encoder.encode('original'), mtimeMs: 1, readonly: true } });
    vi.spyOn(fake.fs, 'saveDialog').mockResolvedValue('/readonly.md');
    controller = new DocumentController({ fs: fake.fs });
    await controller.newDocument();
    controller.handleSourceChange('draft');
    expect(await controller.saveAs()).toBe(false);
    expect(fake.readText('/readonly.md')).toBe('original');
    expect(controller.getText()).toBe('draft');
  });

  it('组合输入期间不自动保存，手动保存等到选字完成', async () => {
    vi.useFakeTimers();
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 } });
    const write = vi.spyOn(fake.fs, 'writeFile');
    controller = new DocumentController({ fs: fake.fs, autoSaveDelay: 20 });
    await controller.openPath('/a.md');
    controller.handleCompositionChange(true);
    controller.handleSourceChange('<div>zhong</div>');
    await vi.advanceTimersByTimeAsync(100);
    expect(write).not.toHaveBeenCalled();
    const saving = controller.save();
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    controller.handleSourceChange('<div>中</div>');
    controller.handleCompositionChange(false);
    expect(await saving).toBe(true);
    expect(fake.readText('/a.md')).toBe('<div>中</div>');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('检查外部修改期间新输入的内容不会被重新载入覆盖', async () => {
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 } });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath('/a.md');
    fake.touch('/a.md', encoder.encode('<div>external</div>'));
    const stat = fake.fs.stat;
    let release!: () => void;
    let entered!: () => void;
    const enteredStat = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(fake.fs, 'stat').mockImplementationOnce(async (path) => {
      entered(); await gate; return stat(path);
    });
    const checking = controller.checkExternal();
    await enteredStat;
    controller.handleSourceChange('<div>local</div>');
    release();
    await checking;
    expect(controller.getText()).toBe('<div>local</div>');
    expect(controller.getSnapshot().conflict).not.toBeNull();
  });


  it('另存为对话框失败时保持当前改动，阻止关闭', async () => {
    const fake = createFakeFs({});
    vi.spyOn(fake.fs, 'saveDialog').mockRejectedValue(new Error('dialog unavailable'));
    controller = new DocumentController({ fs: fake.fs, confirmUnsaved: async () => 'save' });
    await controller.newDocument();
    controller.handleSourceChange('draft');
    expect(await controller.prepareToClose()).toBe(false);
    expect(controller.getText()).toBe('draft');
    expect(controller.getSnapshot().dirty).toBe(true);
  });

  it('受保护的原路径即使被外部删除，另存为也不能直接改写其编码', async () => {
    const original = new Uint8Array([...encoder.encode('<div>'), 0xd6, 0xd0, ...encoder.encode('</div>')]);
    const fake = createFakeFs({ '/a.md': { bytes: original, mtimeMs: 1 } });
    controller = new DocumentController({ fs: fake.fs });
    await controller.openPath('/a.md');
    fake.files.delete('/a.md');
    controller.handleSourceChange('<div>changed</div>');
    vi.spyOn(fake.fs, 'saveDialog').mockResolvedValue('/a.md');
    vi.spyOn(fake.fs, 'sameFile').mockResolvedValue(false);
    expect(await controller.saveAs()).toBe(false);
    expect(fake.files.has('/a.md')).toBe(false);
    expect(controller.getSnapshot().dirty).toBe(true);
  });


  it('新建和打开文档会更换文档标识，取消切换则保留标识', async () => {
    const fake = createFakeFs({ '/a.md': { bytes: encoder.encode('<div>A</div>'), mtimeMs: 1 } });
    controller = new DocumentController({ fs: fake.fs, confirmUnsaved: async () => 'cancel' });
    await controller.newDocument();
    const first = controller.getSnapshot().documentId;
    await controller.newDocument();
    expect(controller.getSnapshot().documentId).toBeGreaterThan(first);
    await controller.openPath('/a.md');
    const opened = controller.getSnapshot().documentId;
    controller.setAutoSave(false);
    controller.handleSourceChange('<div>draft</div>');
    await controller.newDocument();
    expect(controller.getSnapshot().documentId).toBe(opened);
  });

});
