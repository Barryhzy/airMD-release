import { useCallback, useLayoutEffect, useState } from 'react';
import {
  FONT_SIZE_STORAGE_KEY,
  clampFontSize,
  fontScale,
  parseFontSize,
} from '../core/settings/fontSize';

/**
 * 正文字号是「阅读偏好」而不是文档属性：
 * 只写 CSS 变量 + localStorage，不进 Markdown、不参与 DocumentController 的状态机，
 * 所以调整字号不会把文档标脏，也不会触发自动保存。
 */
export function useDocFontSize(): [number, (next: number) => void] {
  const [size, setSize] = useState(() => parseFontSize(localStorage.getItem(FONT_SIZE_STORAGE_KEY)));

  // 用 layout effect：在首帧绘制前就把变量写进去，避免「先按默认字号闪一下」
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--doc-font-size', `${size}px`);
    root.style.setProperty('--doc-font-scale', String(fontScale(size)));
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(size));
  }, [size]);

  const update = useCallback((next: number) => setSize(clampFontSize(next)), []);

  return [size, update];
}
