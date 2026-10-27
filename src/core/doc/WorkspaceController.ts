import { errorMessage, t } from '../settings/language';
import { DocumentController, type ControllerDeps } from './DocumentController';

export interface DocumentTab {
  id: number;
  controller: DocumentController;
}
interface WorkspaceSnapshot {
  tabs: DocumentTab[];
  activeId: number | null;
  error: string | null;
}

/** 一个标签拥有一个文档控制器；切换只改变可见性，正文和撤销历史留在原实例中。 */
export class WorkspaceController {
  #state: WorkspaceSnapshot = { tabs: [], activeId: null, error: null };
  #listeners = new Set<() => void>();
  #operations: Promise<unknown> = Promise.resolve();
  #nextId = 0;
  #untitled = 0;
  #approvedClose: Map<DocumentController, string> | null = null;
  #welcome: DocumentController;
  constructor(private deps: ControllerDeps) { this.#welcome = new DocumentController(deps); }

  getSnapshot = (): WorkspaceSnapshot => this.#state;
  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };
  getActiveController = (): DocumentController => this.#state.tabs.find((tab) => tab.id === this.#state.activeId)?.controller ?? this.#welcome;
  #set(patch: Partial<WorkspaceSnapshot>): void {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }
  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operations.then(operation);
    this.#operations = result.catch(() => {});
    return result;
  }
  #error(error: unknown): void {
    this.#set({ error: t("文档操作未完成：{0}", { "0": errorMessage(error) }) });
  }
  #run(operation: () => Promise<void>): Promise<void> {
    return this.#enqueue(async () => {
      this.#approvedClose = null;
      this.#set({ error: null });
      await operation();
    }).catch((error) => this.#error(error));
  }
  dismissError = (): void => this.#set({ error: null });

  async #find(path: string, except?: number): Promise<DocumentTab | undefined> {
    const candidates = this.#state.tabs.filter((tab) => tab.id !== except && tab.controller.getSnapshot().path);
    const exact = candidates.find((tab) => tab.controller.getSnapshot().path === path);
    if (exact) return exact;
    for (const tab of candidates) {
      if (await this.deps.fs.sameFile(path, tab.controller.getSnapshot().path!)) return tab;
    }
    return undefined;
  }
  #create(): DocumentTab {
    const id = ++this.#nextId;
    const controller = new DocumentController({
      ...this.deps,
      confirmUnsaved: async (snapshot) => {
        const active = this.getActiveController();
        if (active !== controller) await active.syncInput();
        this.#set({ activeId: id });
        return await this.deps.confirmUnsaved?.(snapshot) ?? 'cancel';
      },
      canSaveTo: async (path) => !await this.#find(path, id),
    });
    const tab = { id, controller };
    this.#set({ tabs: [...this.#state.tabs, tab], activeId: id });
    return tab;
  }

  newDocument = (): Promise<void> => this.#run(async () => {
    await this.getActiveController().syncInput();
    await this.#create().controller.newDocument(t("未命名 {0}", { "0": ++this.#untitled }));
  });
  openPath = (path: string): Promise<void> => this.#run(async () => {
    await this.getActiveController().syncInput();
    const existing = await this.#find(path);
    if (existing) {
      this.#set({ activeId: existing.id });
      if (existing.controller.getSnapshot().status === 'error') await existing.controller.openPath(path);
      return;
    }
    await this.#create().controller.openPath(path);
  });
  openViaDialog = async (): Promise<void> => {
    try {
      const paths = await this.deps.fs.openDialog();
      for (const path of paths ?? []) await this.openPath(path);
    } catch (error) { this.#error(error); }
  };
  activate = (id: number): Promise<void> => this.#run(async () => {
    if (id === this.#state.activeId || !this.#state.tabs.some((tab) => tab.id === id)) return;
    await this.getActiveController().syncInput();
    this.#set({ activeId: id });
  });
  cycle = (direction: number): Promise<void> => this.#run(async () => {
    const { tabs, activeId } = this.#state;
    if (tabs.length < 2) return;
    await this.getActiveController().syncInput();
    const index = tabs.findIndex((tab) => tab.id === activeId);
    this.#set({ activeId: tabs[(index + direction + tabs.length) % tabs.length].id });
  });
  close = (id: number): Promise<void> => this.#run(async () => {
    const index = this.#state.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    await this.getActiveController().syncInput();
    const tab = this.#state.tabs[index];
    if (!await tab.controller.closeDocument()) return;
    const tabs = this.#state.tabs.filter((tab) => tab.id !== id);
    this.#set({ tabs, activeId: this.#state.activeId === id ? (tabs[index] ?? tabs[index - 1])?.id ?? null : this.#state.activeId });
  });

  save = (saveAs = false): Promise<void> => this.#run(async () => {
    const controller = this.getActiveController();
    if (controller.getSnapshot().status !== 'ready') return;
    if (saveAs) await controller.saveAs();
    else await controller.save();
  });
  flush = async (): Promise<void> => {
    // 已明确确认退出时，beforeunload/失焦不能再把选择放弃的内容写回磁盘。
    if (this.#isApprovedClose()) return;
    await Promise.allSettled(this.#state.tabs.map((tab) => tab.controller.flush()));
  };
  #isApprovedClose(): boolean {
    return this.#approvedClose !== null && this.#state.tabs.every((tab) => tab.controller.getText() === this.#approvedClose!.get(tab.controller));
  }
  hasUnsavedChanges = (): boolean => {
    if (this.#isApprovedClose()) return false;
    let dirty = false;
    for (const tab of this.#state.tabs) {
      tab.controller.getText();
      dirty ||= tab.controller.getSnapshot().dirty;
    }
    return dirty;
  };
  prepareToClose = (): Promise<boolean> => this.#enqueue(async () => {
    this.#approvedClose = null;
    await this.getActiveController().syncInput();
    const approved = new Map<DocumentController, string>();
    for (const { controller } of this.#state.tabs) {
      if (!await controller.prepareToClose()) return false;
      approved.set(controller, controller.getText());
    }
    // 检查前面确认过的文档是否又有新输入，不能凭旧确认退出整个窗口。
    for (const tab of this.#state.tabs) {
      await tab.controller.syncInput();
      if (tab.controller.getText() !== approved.get(tab.controller)) {
        this.#set({ activeId: tab.id });
        return false;
      }
    }
    this.#approvedClose = approved;
    return true;
  }).catch((error) => { this.#error(error); return false; });
}
