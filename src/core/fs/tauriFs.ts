import { t } from '../settings/language';
import { invoke } from '@tauri-apps/api/core';
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import type { FileStat, FsAdapter, ProjectIndex } from './types';
import { extname } from '../markdown/codec';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
};

export function mimeFromPath(path: string): string {
  return MIME_BY_EXT[extname(path)] ?? 'application/octet-stream';
}

/** 分块 base64 编码，避免 String.fromCharCode 参数过多导致栈溢出 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(i + chunk, bytes.length);
    for (let j = i; j < end; j += 1) binary += String.fromCharCode(bytes[j]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export const tauriFs: FsAdapter = {
  kind: 'tauri',
  nativeDialogs: true,

  async openDialog() {
    const picked = await openFileDialog({
      multiple: false,
      directory: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn'] }],
    });
    if (!picked) return null;
    if (Array.isArray(picked)) return picked;
    return [picked];
  },

  async saveDialog(defaultPath) {
    const target = await saveFileDialog({
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    return target ?? null;
  },

  async openFolderDialog() {
    const picked = await openFileDialog({ multiple: false, directory: true, title: t("打开项目文件夹") });
    return Array.isArray(picked) ? picked[0] ?? null : picked;
  },

  async scanProject(root) {
    return invoke<ProjectIndex>('scan_project', { root });
  },

  async readFile(path) {
    const base64 = await invoke<string>('read_file_base64', { path });
    return base64ToBytes(base64);
  },

  async writeFile(path, bytes) {
    await invoke('write_file_bytes', { path, dataBase64: bytesToBase64(bytes) });
  },

  async stat(path) {
    return invoke<FileStat>('file_stat', { path });
  },

  async exists(path) {
    return invoke<boolean>('path_exists', { path });
  },

  async sameFile(left, right) {
    return invoke<boolean>('same_file', { left, right });
  },

  async readImageAsDataUrl(path) {
    // 直接在 Rust 侧拿到 base64，省掉 Blob → FileReader 的一次拷贝
    const base64 = await invoke<string>('read_file_base64', { path });
    return `data:${mimeFromPath(path)};base64,${base64}`;
  },

  async writeAttachment(dir, fileName, bytes) {
    return invoke<string>('write_attachment', {
      dir,
      fileName,
      dataBase64: bytesToBase64(bytes),
    });
  },

  async listDir(dir) {
    return invoke<string[]>('list_dir', { dir });
  },

  async ensureDir(dir) {
    await invoke('ensure_dir', { dir });
  },

  async revealInFileManager(path) {
    await invoke('reveal_in_file_manager', { path });
  },
};
