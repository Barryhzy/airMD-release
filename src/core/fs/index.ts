import type { FsAdapter } from './types';
import { tauriFs } from './tauriFs';
import { browserFs } from './browserFs';

/** 是否运行在 Tauri 桌面壳里 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return '__TAURI_INTERNALS__' in w || '__TAURI__' in w;
}

export const fs: FsAdapter = isTauri() ? tauriFs : browserFs;

export * from './types';
export * from './paths';
