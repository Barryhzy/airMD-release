/**
 * 正文字号的领域逻辑。
 *
 * 编辑器里所有排版尺寸都从 `--doc-font-size` 派生（见 styles/editor.css），
 * 所以「字号设置」本质上只是维护一个数字：范围、步长、脏数据容错都在这里，
 * 不碰 DOM / localStorage，方便单测。
 */

/** 可调范围：再小中文就糊了，再大一行放不下几个字 */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_STEP = 0.5;
export const FONT_SIZE_DEFAULT = 16.5;

/** 全局偏好，不属于任何文档 */
export const FONT_SIZE_STORAGE_KEY = 'airmd.fontSize';

export const FONT_SIZE_PRESETS: ReadonlyArray<{ label: string; size: number }> = [
  { label: '小', size: 14 },
  { label: '标准', size: 16.5 },
  { label: '大', size: 18.5 },
  { label: '特大', size: 20.5 },
];

/** 对齐到 0.5，否则反复加减会累积出 17.000000000000004 这种值 */
function quantize(value: number): number {
  return Math.round(value / FONT_SIZE_STEP) * FONT_SIZE_STEP;
}

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return FONT_SIZE_DEFAULT;
  return quantize(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value)));
}

export function stepFontSize(current: number, direction: 1 | -1): number {
  return clampFontSize(clampFontSize(current) + direction * FONT_SIZE_STEP);
}

/** localStorage 里可能是脏数据（旧版本、手改、被清空），一律回落到默认值 */
export function parseFontSize(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return FONT_SIZE_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return FONT_SIZE_DEFAULT;
  return clampFontSize(parsed);
}

/**
 * 相对默认字号的倍率。
 * 源码模式是等宽字体、尺寸固定，靠这个倍率跟着一起缩放，
 * 免得「调了字号但切到源码模式没反应」。
 */
export function fontScale(size: number): number {
  return Math.round((clampFontSize(size) / FONT_SIZE_DEFAULT) * 1000) / 1000;
}

/** 显示用：整数不带小数点，16.5 保留一位 */
export function formatFontSize(size: number): string {
  const value = clampFontSize(size);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
