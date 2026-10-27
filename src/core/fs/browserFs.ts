import { t } from '../settings/language';
/**
 * 浏览器演示模式的文件系统实现。
 *
 * 存在的意义有两个：
 * 1. `npm run dev` 时无需 Rust 就能体验完整编辑器；
 * 2. 自动化端到端测试可以在真实 Chromium 里跑「打开 → 编辑 → 自动保存 → 重新打开」全链路。
 *
 * 数据存在 localStorage 里，键前缀 `airmd.vfs:`，仅用于演示。
 */

import type { FsAdapter } from './types';
import { bytesToBase64, base64ToBytes, mimeFromPath } from './tauriFs';
import { DEMO_FILES } from '../../dev/fixtures';
import { EXCLUDED_DIRECTORIES, isMarkdownFile } from '../project/tree';

interface Entry {
  base64: string;
  mtimeMs: number;
}

const PREFIX = 'airmd.vfs:';

function key(path: string): string {
  return PREFIX + path;
}

function readEntry(path: string): Entry | null {
  try {
    const raw = localStorage.getItem(key(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry;
    if (typeof parsed?.base64 !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEntry(path: string, entry: Entry): void {
  localStorage.setItem(key(path), JSON.stringify(entry));
}

function seed(): void {
  for (const file of DEMO_FILES) {
    if (!readEntry(file.path)) {
      const bytes = new TextEncoder().encode(file.content);
      writeEntry(file.path, { base64: bytesToBase64(bytes), mtimeMs: Date.now() });
    }
  }
}

function placeholderImage(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="200">
  <rect width="100%" height="100%" fill="#f4f6f8" stroke="#dfe3e8" stroke-dasharray="6 4"/>
  <text x="50%" y="46%" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" fill="#5c6570">${t('本地图片')}</text>
  <text x="50%" y="62%" text-anchor="middle" font-family="ui-monospace,monospace" font-size="13" fill="#8a929b">${name}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const browserFs: FsAdapter = {
  kind: 'browser',
  nativeDialogs: false,

  async openDialog() {
    return null;
  },

  async openFolderDialog() { return '/demo'; },

  async scanProject(root) {
    seed();
    const started = performance.now();
    const prefix = `${root.replace(/\/+$/, '')}/`;
    const paths = Object.keys(localStorage).filter((key) => key.startsWith(PREFIX + prefix)).map((key) => key.slice(PREFIX.length));
    if (!paths.length) throw new Error(t("项目文件夹不存在"));
    const files = paths.filter((path) => {
      const relative = path.slice(prefix.length);
      return isMarkdownFile(relative) && !relative.split('/').slice(0, -1).some((part) => EXCLUDED_DIRECTORIES.has(part.toLowerCase()));
    }).map((path) => ({ path, relativePath: path.slice(prefix.length) }));
    return { root, files, warnings: [], scannedDirectories: 0, elapsedMs: performance.now() - started };
  },

  async saveDialog(defaultPath) {
    // 演示模式下「另存为」直接生成一个同名副本路径
    const base = defaultPath ?? t("未命名");
    return base.replace(/\.md$/i, '') + t("-副本.md");
  },

  async readFile(path) {
    seed();
    const entry = readEntry(path);
    if (!entry) throw new Error(t("文件不存在：{0}", { "0": path }));
    return base64ToBytes(entry.base64);
  },

  async writeFile(path, bytes) {
    writeEntry(path, { base64: bytesToBase64(bytes), mtimeMs: Date.now() });
  },

  async stat(path) {
    seed();
    const entry = readEntry(path);
    if (!entry) return { exists: false, size: 0, mtimeMs: 0, readonly: false };
    return {
      exists: true,
      size: base64ToBytes(entry.base64).byteLength,
      mtimeMs: entry.mtimeMs,
      readonly: false,
    };
  },

  async exists(path) {
    seed();
    return readEntry(path) !== null;
  },

  async sameFile(left, right) {
    return left === right;
  },

  async readImageAsDataUrl(path) {
    seed();
    const entry = readEntry(path);
    if (!entry) return placeholderImage(path);
    const bytes = base64ToBytes(entry.base64);
    return new Promise((resolve, reject) => {
      const blob = new Blob([bytes as unknown as BlobPart], { type: mimeFromPath(path) });
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error(t("图片读取失败")));
      reader.readAsDataURL(blob);
    });
  },

  async writeAttachment(dir, fileName, bytes) {
    const path = `${dir.replace(/[\\/]+$/, '')}/${fileName}`;
    writeEntry(path, { base64: bytesToBase64(bytes), mtimeMs: Date.now() });
    return path;
  },

  async listDir(dir) {
    seed();
    const prefix = `${dir.replace(/[\\/]+$/, '')}/`;
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        const path = k.slice(PREFIX.length);
        if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
          names.push(path.slice(prefix.length));
        }
      }
    }
    return names;
  },

  async ensureDir() {
    /* 虚拟文件系统不需要真正建目录 */
  },

  async revealInFileManager() {
    /* 浏览器环境无对应能力 */
  },
};

export function resetDemoFiles(): void {
  for (const file of DEMO_FILES) {
    localStorage.removeItem(key(file.path));
  }
  seed();
}

export function demoFileList(): { path: string; name: string; description?: string }[] {
  seed();
  return DEMO_FILES.map((f) => ({ path: f.path, name: f.name, description: f.description }));
}
