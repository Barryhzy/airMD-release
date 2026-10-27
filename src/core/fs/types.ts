/**
 * 文件系统抽象层。
 *
 * 桌面（Tauri）与浏览器（演示 / 端到端测试）各有一套实现，
 * 上层业务只需要面对这个接口，因此核心逻辑可以在没有 Rust 的环境里完整测试。
 */

export interface FileStat {
  exists: boolean;
  size: number;
  /** 修改时间（毫秒时间戳） */
  mtimeMs: number;
  readonly: boolean;
}

export interface VirtualFile {
  path: string;
  name: string;
  /** 仅用于浏览器演示模式的展示 */
  description?: string;
}

export interface ProjectFile {
  path: string;
  /** 以 / 分隔的项目内相对路径；绝对路径仍保留系统原生表示。 */
  relativePath: string;
}

export interface ProjectIndex {
  root: string;
  files: ProjectFile[];
  warnings: string[];
  scannedDirectories: number;
  elapsedMs: number;
}

export interface FsAdapter {
  readonly kind: 'tauri' | 'browser';
  /** 是否具备系统级文件对话框 */
  readonly nativeDialogs: boolean;

  /** 弹出打开对话框，返回绝对路径数组；取消返回 null */
  openDialog(): Promise<string[] | null>;
  openFolderDialog(): Promise<string | null>;
  scanProject(root: string): Promise<ProjectIndex>;
  /** 弹出另存为对话框，返回绝对路径；取消返回 null */
  saveDialog(defaultPath?: string): Promise<string | null>;

  readFile(path: string): Promise<Uint8Array>;
  /** 原子写入：先写临时文件再替换，避免中途崩溃导致原文件被截断 */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;
  /** 比较已存在的文件路径，解析符号链接等别名；用于防止另存为绕过原文件保护。 */
  sameFile(left: string, right: string): Promise<boolean>;

  /** 读取本地图片并转成可直接放进 <img src> 的 data URL */
  readImageAsDataUrl(path: string): Promise<string>;

  /** 往指定目录写入一个附件，返回写入后的绝对路径 */
  writeAttachment(dir: string, fileName: string, bytes: Uint8Array): Promise<string>;
  /** 列出目录下的文件名（用于避免重名） */
  listDir(dir: string): Promise<string[]>;
  ensureDir(dir: string): Promise<void>;

  /** 在系统文件管理器中显示文件 */
  revealInFileManager(path: string): Promise<void>;
}

export const EMPTY_STAT: FileStat = { exists: false, size: 0, mtimeMs: 0, readonly: false };

/** 两个 stat 是否代表不同的磁盘状态（用于外部修改检测） */
export function statChanged(prev: FileStat | null, next: FileStat): boolean {
  if (!prev) return true;
  if (prev.exists !== next.exists) return true;
  if (!next.exists) return false;
  return prev.mtimeMs !== next.mtimeMs || prev.size !== next.size;
}
