import { errorMessage, t } from '../settings/language';
/**
 * 文档状态机。
 *
 * 它是整个应用唯一的事实来源：文件字节 ⇄ 编辑文本 ⇄ 编辑器内容 的所有转换、
 * 自动保存、外部修改检测、完整性守卫都在这里收口。
 *
 * 之所以不用「组件内 useState 拼起来」，是因为保存与冲突处理是有顺序的异步流程，
 * 放在一个显式的状态机里才可能被完整测试。
 */

import type { FsAdapter, FileStat } from '../fs/types';
import { statChanged } from '../fs/types';
import {
  basename,
  decodeDocument,
  dirname,
  encodeDocument,
  isSafeForDirectWrite,
  type Eol,
  type TextMeta,
} from '../markdown/codec';
import {
  assessRoundTrip,
  scanUnsupportedSyntax,
  type IntegrityReport,
} from '../markdown/integrity';
import { isIntegritySuppressed, restoreIntegrityPrompt, suppressIntegrity } from '../settings/integrityAllowlist';
import { decideAutosave } from './autosavePolicy';
import { countWords } from './stats';

/** countWords 的输出 → 快照字段（避免直接展开造成字段名对不上） */
function toStateCounts(text: string): { wordCount: number; charCount: number } {
  const { words, chars } = countWords(text);
  return { wordCount: words, charCount: chars };
}
import { isExternalUrl, relativePathFrom, resolveRelativePath, sanitizeFileName, splitUrlSuffix, uniqueFileName } from '../fs/paths';
import type { CrepeHandle } from '../editor/createCrepe';
import { createCrepeEditor, readMarkdown } from '../editor/createCrepe';
import { computeActiveStates, EMPTY_ACTIVE, insertImage, type ActiveStates } from '../editor/commands';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';

export type EditorMode = 'wysiwyg' | 'source';
export type DocStatus = 'empty' | 'loading' | 'ready' | 'error';
export type UnsavedChoice = 'save' | 'discard' | 'cancel';

export interface DocumentSnapshot {
  documentId: number;
  contentVersion: number;
  status: DocStatus;
  path: string | null;
  title: string;
  mode: EditorMode;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  meta: TextMeta | null;
  integrity: IntegrityReport | null;
  integrityAcknowledged: boolean;
  conflict: FileStat | null;
  warnings: string[];
  errorMessage: string | null;
  autoSaveEnabled: boolean;
  readonly: boolean;
  wordCount: number;
  charCount: number;
  notice: { text: string; kind: 'info' | 'warn' | 'error'; at: number } | null;
}

export interface ControllerDeps {
  fs: FsAdapter;
  autoSaveDelay?: number;
  watchInterval?: number;
  confirmUnsaved?: (snapshot: DocumentSnapshot) => Promise<UnsavedChoice>;
  canSaveTo?: (path: string) => Promise<boolean>;
}

const EMPTY_STATE: DocumentSnapshot = {
  documentId: 0,
  contentVersion: 0,
  status: 'empty',
  path: null,
  title: t("未命名"),
  mode: 'wysiwyg',
  dirty: false,
  saving: false,
  lastSavedAt: null,
  meta: null,
  integrity: null,
  integrityAcknowledged: false,
  conflict: null,
  warnings: [],
  errorMessage: null,
  autoSaveEnabled: true,
  readonly: false,
  wordCount: 0,
  charCount: 0,
  notice: null,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DocumentController {
  #deps: ControllerDeps;
  #state: DocumentSnapshot = { ...EMPTY_STATE };
  #listeners = new Set<() => void>();
  #selectionListeners = new Set<() => void>();
  #active: ActiveStates = EMPTY_ACTIVE;

  #mountEl: HTMLElement | null = null;
  #handle: CrepeHandle | null = null;
  /** 当前文本；可视化模式下与 #editorDoc 对应，未收到防抖通知时按需同步。 */
  #text = '';
  /** 上次成功写入磁盘的文本 */
  #savedText = '';
  #lastStat: FileStat | null = null;

  #autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  #watchTimer: ReturnType<typeof setInterval> | null = null;
  #imageCache = new Map<string, string>();
  #pendingEditorBuild = false;
  /** 离开可视化模式那一刻编辑器里的 markdown，用于判断切回来能否直接复用 */
  #wysiwygText = '';
  #buildToken = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | null = null;
  #operations: Promise<unknown> = Promise.resolve();
  #editorDoc: ProseNode | null = null;
  /** 保留序列化表示，首次加载时可能与原文的 Markdown 写法不同。 */
  #editorMarkdown: string | null = null;
  #compositionEnd: Promise<void> | null = null;
  #finishComposition: (() => void) | null = null;

  constructor(deps: ControllerDeps) {
    this.#deps = deps;
  }

  /* ------------------------------------------------------------------ 订阅 */

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): DocumentSnapshot => this.#state;

  subscribeSelection = (fn: () => void): (() => void) => {
    this.#selectionListeners.add(fn);
    return () => this.#selectionListeners.delete(fn);
  };

  getActiveStates = (): ActiveStates => this.#active;

  #set(patch: Partial<DocumentSnapshot>): void {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }

  #notice(text: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
    this.#set({ notice: { text, kind, at: Date.now() } });
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => {
      this.#set({ notice: null });
    }, 4200);
  }

  /* -------------------------------------------------------------- 编辑器挂载 */

  attachMount(el: HTMLElement | null): void {
    this.#mountEl = el;
    if (el && this.#pendingEditorBuild) {
      this.#pendingEditorBuild = false;
      void this.#buildEditor();
    }
  }

  getEditorHandle(): CrepeHandle | null {
    return this.#handle;
  }

  /** 复用当前文档的文本；保存等即时读取在通知防抖结束前也能同步最新输入。 */
  getText(): string {
    this.handleEditorChange();
    return this.#state.mode === 'wysiwyg' && this.#handle ? this.#editorMarkdown ?? this.#text : this.#text;
  }

  /* ------------------------------------------------------------------ 打开 */

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operations.then(async () => {
      await this.#compositionEnd;
      return operation();
    });
    this.#operations = result.catch(() => {});
    return result;
  }

  async #prepareToLeave(): Promise<boolean> {
    this.handleEditorChange();
    this.#cancelAutosave();
    if (!this.#state.dirty) return true;
    if (this.#decide().action === 'save') {
      await this.#save();
      if (!this.#state.dirty) return true;
    }
    const choice = await this.#deps.confirmUnsaved?.(this.#state) ?? 'cancel';
    if (choice === 'discard') return true;
    if (choice === 'save') {
      const protectedFile = this.#state.readonly || this.#state.conflict ||
        (this.#state.meta && !isSafeForDirectWrite(this.#state.meta.encoding));
      const saved = await (protectedFile ? this.#saveAs() : this.#save());
      if (saved && !this.#state.dirty) return true;
    }
    this.#notice(t("当前文档仍有未保存的改动，已保留在编辑器中。"), 'warn');
    return false;
  }

  prepareToClose(): Promise<boolean> {
    return this.#enqueue(() => this.#prepareToLeave());
  }

  /** 标签隐藏前等组合输入与已排队操作结束，但不要求放弃未保存内容。 */
  syncInput(): Promise<void> {
    return this.#enqueue(async () => { this.handleEditorChange(); });
  }

  closeDocument(): Promise<boolean> {
    return this.#enqueue(async () => {
      if (!await this.#prepareToLeave()) return false;
      await this.#teardown();
      if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
      return true;
    });
  }

  newDocument(title = t("未命名")): Promise<void> {
    return this.#enqueue(async () => {
      if (await this.#prepareToLeave()) await this.#newDocument(title);
    });
  }

  async #newDocument(title: string): Promise<void> {
    await this.#teardown();
    this.#text = '';
    this.#savedText = '';
    this.#lastStat = null;
    this.#set({
      ...EMPTY_STATE,
      documentId: this.#state.documentId + 1,
      title,
      status: 'ready',
      mode: 'wysiwyg',
      autoSaveEnabled: this.#state.autoSaveEnabled,
    });
    this.#pendingEditorBuild = true;
    if (this.#mountEl) {
      this.#pendingEditorBuild = false;
      await this.#buildEditor();
    }
  }

  openPath(path: string): Promise<void> {
    return this.#enqueue(async () => {
      if (await this.#prepareToLeave()) await this.#openPath(path);
    });
  }

  async #openPath(path: string): Promise<void> {
    await this.#teardown();
    this.#set({
      ...EMPTY_STATE,
      documentId: this.#state.documentId + 1,
      status: 'loading',
      path,
      title: basename(path),
      autoSaveEnabled: this.#state.autoSaveEnabled,
    });

    try {
      const [bytes, stat] = await Promise.all([this.#deps.fs.readFile(path), this.#deps.fs.stat(path)]);
      const { text, meta, warnings } = decodeDocument(bytes);

      this.#text = text;
      this.#savedText = text;
      this.#lastStat = stat;
      this.#imageCache.clear();

      const counts = toStateCounts(text);
      const risky = scanUnsupportedSyntax(text);
      // 用户点过「不再提示（所有 Markdown）」：直接进可视化，并按「已确认」处理，
      // 否则 autosavePolicy 会因为 data-loss 把自动保存一直拦住。
      const allowed = risky.length > 0 && isIntegritySuppressed();

      // 含内嵌 HTML / frontmatter 的文档：直接以源码模式打开，绝不让编辑器「过一遍」
      if (risky.length > 0 && !allowed) {
        this.#set({
          status: 'ready',
          mode: 'source',
          path,
          title: basename(path),
          meta,
          warnings,
          integrity: {
            risk: 'data-loss',
            identical: false,
            droppedNodeTypes: risky.map((r) => r.type),
            addedNodeTypes: [],
            notes: [t("文档包含{0}，可视化编辑器无法完整保留。", { "0": risky.map((r) => t("{0}（{1} 处）", { "0": r.label, "1": r.count })).join('、') })],
            sourceLength: text.length,
            outputLength: 0,
          },
          readonly: stat.readonly,
          ...counts,
        });
        this.#startWatching();
        return;
      }

      this.#set({
        status: 'ready',
        mode: 'wysiwyg',
        path,
        title: basename(path),
        meta,
        warnings,
        readonly: stat.readonly,
        ...(allowed ? { integrityAcknowledged: true } : {}),
        ...counts,
      });

      this.#pendingEditorBuild = true;
      if (this.#mountEl) {
        this.#pendingEditorBuild = false;
        await this.#buildEditor();
      }
      this.#startWatching();
    } catch (error) {
      this.#set({
        status: 'error',
        errorMessage: t("无法打开文件：{0}", { "0": errorMessage(error) }),
      });
    }
  }

  async openViaDialog(): Promise<void> {
    const picked = await this.#deps.fs.openDialog();
    if (!picked || picked.length === 0) return;
    await this.openPath(picked[0]);
  }

  /* ------------------------------------------------------------------ 保存 */

  save(): Promise<boolean> {
    return this.#enqueue(() => this.#save());
  }

  #writeProtection(): string | null {
    const s = this.#state;
    if (s.readonly) return t("文件是只读的，请另存为新文件。");
    if (s.meta && !isSafeForDirectWrite(s.meta.encoding)) return t("原文件编码受保护，请另存为 UTF-8 新文件。");
    if (s.conflict) return t("请先处理文件冲突，或另存为新文件。");
    if (s.mode === 'wysiwyg' && s.integrity?.risk === 'data-loss' && !s.integrityAcknowledged) {
      return t("请先切到源码模式，或明确确认可视化编辑的内容风险。");
    }
    return null;
  }

  async #save(): Promise<boolean> {
    const snapshot = this.#state;
    if (!snapshot.path) return this.#saveAs();
    const protection = this.#writeProtection();
    if (protection) {
      this.#notice(protection, 'warn');
      return false;
    }

    this.#cancelAutosave();
    this.#set({ saving: true });

    try {
      // 写之前先确认磁盘没被别的程序改过
      const before = await this.#deps.fs.stat(snapshot.path);
      if (before.readonly) {
        this.#set({ saving: false, readonly: true });
        this.#notice(t("文件已变为只读，请另存为新文件。"), 'warn');
        return false;
      }
      if (statChanged(this.#lastStat, before)) {
        this.#set({ saving: false, conflict: before });
        this.#notice(t("文件已被其它程序修改，本次保存已取消。"), 'warn');
        return false;
      }

      await this.#compositionEnd;
      this.handleEditorChange();
      const text = this.getText();
      const meta = snapshot.meta ?? { encoding: 'utf-8' as const, eol: '\n' as Eol, mixedEol: false, trailingNewlines: 0 };
      const bytes = encodeDocument(text, meta);
      await this.#deps.fs.writeFile(snapshot.path, bytes);

      const after = await this.#deps.fs.stat(snapshot.path);
      this.#lastStat = after;
      this.#savedText = text;
      this.handleEditorChange();
      this.#text = this.getText();
      if (this.#handle) this.#imageCache.clear();

      this.#set({
        saving: false,
        dirty: this.#text !== text,
        conflict: null,
        lastSavedAt: Date.now(),
        meta: { ...meta },
      });
      this.#scheduleAutosave();
      return true;
    } catch (error) {
      this.#set({ saving: false, errorMessage: t("保存失败：{0}", { "0": errorMessage(error) }) });
      this.#notice(t("保存失败：{0}", { "0": errorMessage(error) }), 'error');
      return false;
    }
  }

  saveAs(): Promise<boolean> {
    return this.#enqueue(() => this.#saveAs());
  }

  async #saveAs(): Promise<boolean> {
    const suggested = this.#state.path ?? `${this.#state.title || t("未命名")}.md`;
    let target: string | null;
    try {
      target = await this.#deps.fs.saveDialog(suggested);
    } catch (error) {
      this.#notice(t("无法打开另存为对话框：{0}", { "0": errorMessage(error) }), 'error');
      return false;
    }
    if (!target) return false;

    try {
      if (this.#deps.canSaveTo && !await this.#deps.canSaveTo(target)) {
        this.#notice(t("目标文件已在其他标签中打开，请切换到该标签编辑。"), 'warn');
        return false;
      }
      if (this.#state.path && (this.#state.path === target || await this.#deps.fs.sameFile(this.#state.path, target))) {
        return await this.#save();
      }
      if ((await this.#deps.fs.stat(target)).readonly) {
        this.#notice(t("目标文件是只读的，请选择其他路径。"), 'warn');
        return false;
      }
    } catch (error) {
      this.#notice(t("无法确认另存为目标：{0}", { "0": errorMessage(error) }), 'error');
      return false;
    }
    await this.#compositionEnd;
    this.handleEditorChange();

    const text = this.getText();
    const previousMeta = this.#state.meta;
    const meta: TextMeta = previousMeta
      ? {
          ...previousMeta,
          encoding: isSafeForDirectWrite(previousMeta.encoding) ? previousMeta.encoding : 'utf-8',
        }
      : { encoding: 'utf-8', eol: '\n', mixedEol: false, trailingNewlines: 0 };

    try {
      this.#cancelAutosave();
      this.#set({ saving: true });
      await this.#deps.fs.writeFile(target, encodeDocument(text, meta));
      const stat = await this.#deps.fs.stat(target);
      this.#lastStat = stat;
      this.#savedText = text;
      this.handleEditorChange();
      this.#text = this.getText();
      this.#set({
        status: 'ready',
        path: target,
        title: basename(target),
        meta,
        dirty: this.#text !== text,
        saving: false,
        conflict: null,
        lastSavedAt: Date.now(),
        warnings: [],
        readonly: false,
      });
      this.#notice(t("已另存为 {0}", { "0": basename(target) }), 'info');
      this.#startWatching();
      this.#scheduleAutosave();
      return true;
    } catch (error) {
      this.#set({ saving: false });
      this.#notice(t("另存为失败：{0}", { "0": errorMessage(error) }), 'error');
      return false;
    }
  }

  /* ------------------------------------------------------------- 内容变更 */

  handleEditorChange = (serialized?: string, serializedDoc?: ProseNode): void => {
    if (!this.#handle || this.#state.mode !== 'wysiwyg' || this.#compositionEnd) return;
    const doc = this.#handle.editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
    if (this.#editorDoc && doc.eq(this.#editorDoc)) return;
    this.#editorDoc = doc;
    // 防抖通知可能落后于即时保存；只复用确实属于当前节点的序列化结果。
    const markdown = serialized !== undefined && serializedDoc === doc ? serialized : readMarkdown(this.#handle);
    this.#editorMarkdown = markdown;
    if (markdown === this.#text) return;
    this.#text = markdown;
    const counts = toStateCounts(markdown);
    this.#set({ contentVersion: this.#state.contentVersion + 1, dirty: markdown !== this.#savedText, ...counts });
    this.#scheduleAutosave();
  };

  handleSourceChange = (value: string): void => {
    if (value === this.#text) return;
    this.#text = value;
    const counts = toStateCounts(value);
    this.#set({ contentVersion: this.#state.contentVersion + 1, dirty: value !== this.#savedText, ...counts });
    this.#scheduleAutosave();
  };

  #selectionFrame = 0;

  handleCompositionChange = (composing: boolean): void => {
    if (composing) {
      this.#cancelAutosave();
      if (!this.#compositionEnd) {
        this.#compositionEnd = new Promise((resolve) => { this.#finishComposition = resolve; });
      }
      return;
    }
    const finish = this.#finishComposition;
    this.#compositionEnd = null;
    this.#finishComposition = null;
    this.handleEditorChange();
    if (this.#handle) this.handleSelectionChange();
    this.#scheduleAutosave();
    finish?.();
  };

  handleSelectionChange = (): void => {
    if (this.#selectionFrame || this.#compositionEnd) return;
    this.#selectionFrame = requestAnimationFrame(() => {
      this.#selectionFrame = 0;
      if (this.#compositionEnd) return;
      const active = computeActiveStates(this.#handle?.editor ?? null);
      if ((Object.keys(active) as (keyof ActiveStates)[]).every((key) => active[key] === this.#active[key])) return;
      this.#active = active;
      for (const fn of this.#selectionListeners) fn();
    });
  };

  /* --------------------------------------------------------------- 模式切换 */

  setMode(mode: EditorMode): Promise<void> {
    return this.#enqueue(() => this.#setMode(mode));
  }

  async #setMode(mode: EditorMode): Promise<void> {
    if (mode === this.#state.mode) return;

    if (mode === 'source') {
      const markdown = this.getText();
      this.#text = markdown;
      // 不销毁编辑器：源码模式只是把它藏起来（App 里用 display:none），
      // 切回来时若源码没改动就直接复用，省掉一次 Crepe 重建（约 100ms）。
      this.#wysiwygText = markdown;
      this.#set({ mode: 'source', dirty: markdown !== this.#savedText });
      return;
    }

    // 源码 → 可视化：没有编辑器、或源码被改过，才需要重建 + 完整性体检
    const canReuse = this.#handle !== null && this.#text === this.#wysiwygText;
    this.#set({ mode: 'wysiwyg' });
    if (canReuse) return;

    this.#pendingEditorBuild = true;
    if (this.#mountEl) {
      this.#pendingEditorBuild = false;
      await this.#buildEditor();
    }
  }

  /* ------------------------------------------------------------------ 冲突 */

  resolveConflict(choice: 'reload' | 'overwrite' | 'save-as'): Promise<void> {
    return this.#enqueue(() => this.#resolveConflict(choice));
  }

  async #resolveConflict(choice: 'reload' | 'overwrite' | 'save-as'): Promise<void> {
    const snapshot = this.#state;
    if (!snapshot.path) return;

    if (choice === 'save-as') {
      await this.#saveAs();
      return;
    }

    if (choice === 'reload') {
      const path = snapshot.path;
      await this.#openPath(path);
      this.#notice(t("已重新载入磁盘上的最新内容。"), 'info');
      return;
    }

    // 用户明确选择用本地内容覆盖外部改动
    const stat = await this.#deps.fs.stat(snapshot.path);
    this.#lastStat = stat;
    this.#set({ conflict: null });
    const ok = await this.#save();
    if (ok) this.#notice(t("已用当前内容覆盖磁盘文件。"), 'warn');
  }

  acknowledgeIntegrity(): void {
    this.#set({ integrityAcknowledged: true });
  }

  /** 用户坚持在可视化模式下编辑一个会丢内容的文档 */
  async forceWysiwyg(): Promise<void> {
    this.acknowledgeIntegrity();
    await this.setMode('wysiwyg');
  }

  /**
   * 「不再提示（所有 Markdown）」：写全局开关后立刻进可视化。
   * 恢复入口在「更多」菜单里（restoreIntegrity）。
   */
  async rememberIntegrity(): Promise<void> {
    const saved = suppressIntegrity();
    if (!saved) this.#notice(t("无法保存偏好，本次先按可视化打开。"), 'warn');
    await this.forceWysiwyg();
  }

  /** 重新开启完整性提醒（只影响之后打开的文档） */
  restoreIntegrity(): void {
    restoreIntegrityPrompt();
    this.#notice(t("已恢复 HTML 完整性提醒，新打开的文档会重新提示。"), 'info');
  }

  setAutoSave(enabled: boolean): void {
    this.#set({ autoSaveEnabled: enabled });
    if (enabled) this.#scheduleAutosave();
  }

  /* ------------------------------------------------------------ 自动保存内核 */

  #scheduleAutosave(): void {
    this.#cancelAutosave();
    const decision = this.#decide();
    if (decision.action !== 'save' || this.#compositionEnd) return;
    this.#autosaveTimer = setTimeout(() => {
      void this.#runAutosave();
    }, this.#deps.autoSaveDelay ?? 900);
  }

  #cancelAutosave(): void {
    if (this.#autosaveTimer) {
      clearTimeout(this.#autosaveTimer);
      this.#autosaveTimer = null;
    }
  }

  #decide() {
    const s = this.#state;
    return decideAutosave({
      path: s.path,
      dirty: s.dirty,
      saving: s.saving,
      encoding: s.meta?.encoding ?? 'utf-8',
      integrityRisk: s.integrity?.risk ?? 'none',
      integrityAcknowledged: s.integrityAcknowledged,
      conflict: s.conflict !== null,
      readonly: s.readonly,
      autoSaveEnabled: s.autoSaveEnabled,
      sourceMode: s.mode === 'source',
    });
  }

  async #runAutosave(): Promise<void> {
    await this.#enqueue(async () => {
      if (this.#decide().action === 'save') await this.#save();
    });
  }

  /** 窗口失焦 / 关闭前调用，确保不丢最后几个字符 */
  async flush(): Promise<void> {
    this.#cancelAutosave();
    await this.#enqueue(async () => {
      this.handleEditorChange();
      if (this.#decide().action === 'save') await this.#save();
    });
  }

  /* ---------------------------------------------------------- 外部修改检测 */

  #startWatching(): void {
    this.#stopWatching();
    const interval = this.#deps.watchInterval ?? 1500;
    this.#watchTimer = setInterval(() => {
      void this.checkExternal();
    }, interval);
  }

  #stopWatching(): void {
    if (this.#watchTimer) {
      clearInterval(this.#watchTimer);
      this.#watchTimer = null;
    }
  }

  checkExternal(): Promise<void> {
    return this.#enqueue(() => this.#checkExternal());
  }

  async #checkExternal(): Promise<void> {
    const s = this.#state;
    if (!s.path || s.saving || s.status !== 'ready') return;
    try {
      const stat = await this.#deps.fs.stat(s.path);
      if (!statChanged(this.#lastStat, stat)) return;
      // stat 等待期间可能又有输入；以此刻的文档为准，不能用旧的 dirty。
      await this.#compositionEnd;
      this.handleEditorChange();

      if (!this.#state.dirty) {
        // 没有本地改动 → 直接跟随磁盘（不打扰用户）
        const path = s.path;
        await this.#openPath(path);
        this.#notice(t("检测到文件被外部修改，已自动重新载入。"), 'info');
        return;
      }

      this.#cancelAutosave();
      this.#set({ conflict: stat });
      this.#notice(t("文件已被外部修改，自动保存已暂停。"), 'warn');
    } catch {
      /* 瞬时读取失败忽略，下一轮再试 */
    }
  }

  /* -------------------------------------------------------------- 编辑器生命周期 */

  async #buildEditor(): Promise<void> {
    const token = ++this.#buildToken;
    const el = this.#mountEl;
    if (!el) return;

    await this.#destroyEditor();
    if (token !== this.#buildToken) return;

    const mount = document.createElement('div');
    mount.className = 'editor-mount';
    el.replaceChildren(mount);

    // 初始化期间就可能触发 onChange，因此用可空引用而不是闭包里的 const
    let created: CrepeHandle | null = null;

    const handle = await createCrepeEditor({
      root: mount,
      defaultValue: this.#text,
      proxyImageUrl: (url) => this.#proxyImage(url),
      onChange: (markdown, doc) => {
        this.handleEditorChange(markdown, doc);
        if (!this.#compositionEnd) created?.refreshImages();
      },
      onSelectionChange: () => this.handleSelectionChange(),
      onCompositionChange: this.handleCompositionChange,
      onCodeCopied: () => this.#notice(t("代码已复制")),
    });
    created = handle;

    if (token !== this.#buildToken) {
      await handle.destroy();
      return;
    }
    this.#handle = handle;
    this.#editorDoc = handle.editor.action((ctx) => ctx.get(editorViewCtx).state.doc);

    // 挂载后立刻做一次往返体检：编辑器回写的内容必须与原文本语义一致
    await sleep(0);
    if (token !== this.#buildToken || handle !== this.#handle) return;
    const roundTrip = readMarkdown(handle);
    this.#editorMarkdown = roundTrip;
    const report = assessRoundTrip(this.#text, roundTrip);

    if (report.risk === 'data-loss' && !this.#state.integrityAcknowledged) {
      await this.#destroyEditor();
      el.replaceChildren();
      this.#set({ mode: 'source', integrity: report, dirty: this.#text !== this.#savedText });
      this.#notice(t("该文档无法完整可视化，已切换为源码模式以保护内容。"), 'warn');
      return;
    }

    this.#wysiwygText = this.#text;
    this.#set({ integrity: report, dirty: this.#text !== this.#savedText });
  }

  async #destroyEditor(): Promise<void> {
    if (this.#selectionFrame) cancelAnimationFrame(this.#selectionFrame);
    this.#selectionFrame = 0;
    if (!this.#handle) return;
    const handle = this.#handle;
    this.#handle = null;
    this.#editorDoc = null;
    this.#editorMarkdown = null;
    try {
      await handle.destroy();
    } catch {
      /* 已经销毁 */
    }
  }

  async #teardown(): Promise<void> {
    this.#stopWatching();
    this.#cancelAutosave();
    const finishComposition = this.#finishComposition;
    this.#compositionEnd = null;
    this.#finishComposition = null;
    finishComposition?.();
    this.#buildToken += 1;
    this.#pendingEditorBuild = false;
    await this.#destroyEditor();
    this.#imageCache.clear();
  }

  /* ------------------------------------------------------------------ 图片 */

  async #proxyImage(url: string): Promise<string> {
    if (isExternalUrl(url)) return url;
    const { path: relPath, suffix } = splitUrlSuffix(url);
    const docPath = this.#state.path;
    if (!docPath) return url;

    const absPath = resolveRelativePath(dirname(docPath), relPath);
    const cached = this.#imageCache.get(absPath);
    if (cached) return cached;

    try {
      const dataUrl = await this.#deps.fs.readImageAsDataUrl(absPath);
      this.#imageCache.set(absPath, dataUrl);
      return dataUrl + suffix;
    } catch {
      return missingImagePlaceholder(relPath);
    }
  }

  async #uploadImage(file: File): Promise<string | null> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const docPath = this.#state.path;

    if (!docPath) {
      this.#notice(t("请先保存文档，插入的图片才能以相对路径引用；当前将嵌入为 data URL。"), 'warn');
      return await fileToDataUrl(file);
    }

    const dir = dirname(docPath);
    try {
      await this.#deps.fs.ensureDir(dir);
      const existing = await this.#deps.fs.listDir(dir);
      const fileName = uniqueFileName(sanitizeFileName(file.name || 'image.png'), existing);
      const written = await this.#deps.fs.writeAttachment(dir, fileName, bytes);
      this.#imageCache.delete(written);
      return relativePathFrom(dir, written);
    } catch (error) {
      this.#notice(t("图片保存失败：{0}", { "0": errorMessage(error) }), 'error');
      return null;
    }
  }

  /** 插入一张本地图片：先落盘到文档同目录，再以相对路径写入 Markdown */
  async insertImageFile(file: File): Promise<void> {
    const src = await this.#uploadImage(file);
    if (!src || !this.#handle) return;
    insertImage(this.#handle.editor, src);
  }

  async dispose(): Promise<void> {
    await this.#teardown();
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(t("读取图片失败")));
    reader.readAsDataURL(file);
  });
}

function missingImagePlaceholder(path: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140">
  <rect width="100%" height="100%" fill="#f6f7f9" stroke="#e1e4e8" stroke-dasharray="5 4"/>
  <text x="50%" y="48%" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#8a929b">${t('图片无法加载')}</text>
  <text x="50%" y="66%" text-anchor="middle" font-family="ui-monospace,monospace" font-size="12" fill="#a8aeb6">${path.replace(/[<>&]/g, '')}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
