import { errorMessage, t } from '../settings/language';
import type { FsAdapter, ProjectIndex } from '../fs/types';

interface ProjectSnapshot {
  root: string | null;
  index: ProjectIndex | null;
  loading: boolean;
  visible: boolean;
  error: string | null;
}
const EMPTY: ProjectSnapshot = { root: null, index: null, loading: false, visible: false, error: null };
const ROOT_KEY = 'airmd.projectRoot';
const VISIBLE_KEY = 'airmd.projectVisible';

/** 独立于编辑器状态；扫描不会因光标或正文变化而重启。 */
export class ProjectController {
  #state = EMPTY;
  #listeners = new Set<() => void>();
  #request = 0;
  constructor(private fs: Pick<FsAdapter, 'openFolderDialog' | 'scanProject'>, private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}

  getSnapshot = (): ProjectSnapshot => this.#state;
  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };
  #set(patch: Partial<ProjectSnapshot>) {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }
  #remember(key: string, value: string | null) {
    try {
      if (value === null) this.storage.removeItem(key);
      else this.storage.setItem(key, value);
    } catch { /* 偏好存储失败不影响项目浏览。 */ }
  }

  async restore(): Promise<void> {
    let root: string | null = null;
    let visible = true;
    try {
      root = this.storage.getItem(ROOT_KEY);
      visible = this.storage.getItem(VISIBLE_KEY) !== 'false';
    } catch { return; }
    if (root) await this.open(root, visible);
  }

  async openViaDialog(): Promise<void> {
    try {
      const root = await this.fs.openFolderDialog();
      if (root) await this.open(root);
    } catch (error) { this.#set({ visible: true, error: t("无法选择文件夹：{0}", { "0": errorMessage(error) }) }); }
  }

  async open(root: string, visible = true): Promise<void> {
    const request = ++this.#request;
    this.#set({ root, visible, loading: true, error: null, index: root === this.#state.root ? this.#state.index : null });
    this.#remember(ROOT_KEY, root);
    this.#remember(VISIBLE_KEY, String(visible));
    try {
      const index = await this.fs.scanProject(root);
      if (request !== this.#request) return;
      this.#set({ root: index.root, index, loading: false });
      this.#remember(ROOT_KEY, index.root);
    } catch (error) {
      if (request === this.#request) this.#set({ loading: false, error: t("无法读取项目：{0}", { "0": errorMessage(error) }) });
    }
  }

  refresh = async (): Promise<void> => {
    if (this.#state.root && !this.#state.loading) await this.open(this.#state.root, this.#state.visible);
  };
  toggle = (): void => {
    this.#set({ visible: !this.#state.visible });
    this.#remember(VISIBLE_KEY, String(this.#state.visible));
  };
  close = (): void => {
    this.#request++;
    this.#state = { ...EMPTY };
    this.#remember(ROOT_KEY, null);
    this.#remember(VISIBLE_KEY, null);
    for (const fn of this.#listeners) fn();
  };
  dispose = (): void => { this.#request++; };
}
