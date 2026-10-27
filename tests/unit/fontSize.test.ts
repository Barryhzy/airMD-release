import { describe, expect, it } from 'vitest';
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_PRESETS,
  clampFontSize,
  fontScale,
  formatFontSize,
  parseFontSize,
  stepFontSize,
} from '../../src/core/settings/fontSize';

describe('正文字号', () => {
  it('默认值是 16.5px', () => {
    expect(FONT_SIZE_DEFAULT).toBe(16.5);
    expect(parseFontSize(null)).toBe(16.5);
    expect(parseFontSize('')).toBe(16.5);
  });

  it('超出范围时夹到上下限', () => {
    expect(clampFontSize(4)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(100)).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(FONT_SIZE_MIN)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(FONT_SIZE_MAX)).toBe(FONT_SIZE_MAX);
  });

  it('对齐到 0.5，避免浮点误差累积', () => {
    expect(clampFontSize(16.4)).toBe(16.5);
    expect(clampFontSize(16.7)).toBe(16.5);
    expect(clampFontSize(17.26)).toBe(17.5);
    let size = FONT_SIZE_DEFAULT;
    for (let i = 0; i < 20; i += 1) size = stepFontSize(size, 1);
    expect(size).toBe(FONT_SIZE_MAX);
    for (let i = 0; i < 40; i += 1) size = stepFontSize(size, -1);
    expect(size).toBe(FONT_SIZE_MIN);
  });

  it('逐步加减在边界处不越界', () => {
    expect(stepFontSize(FONT_SIZE_MAX, 1)).toBe(FONT_SIZE_MAX);
    expect(stepFontSize(FONT_SIZE_MIN, -1)).toBe(FONT_SIZE_MIN);
    expect(stepFontSize(16.5, 1)).toBe(17);
    expect(stepFontSize(16.5, -1)).toBe(16);
  });

  it('脏数据一律回落到默认值', () => {
    expect(parseFontSize('abc')).toBe(FONT_SIZE_DEFAULT);
    expect(parseFontSize('NaN')).toBe(FONT_SIZE_DEFAULT);
    expect(parseFontSize('Infinity')).toBe(FONT_SIZE_DEFAULT);
    expect(parseFontSize(' 18 ')).toBe(18);
    expect(parseFontSize('999')).toBe(FONT_SIZE_MAX);
    expect(parseFontSize('-3')).toBe(FONT_SIZE_MIN);
  });

  it('倍率以默认字号为 1', () => {
    expect(fontScale(FONT_SIZE_DEFAULT)).toBe(1);
    expect(fontScale(18)).toBeCloseTo(18 / 16.5, 3);
    expect(fontScale(FONT_SIZE_MIN)).toBeLessThan(1);
    expect(fontScale(FONT_SIZE_MAX)).toBeGreaterThan(1);
  });

  it('显示格式：整数不带小数点', () => {
    expect(formatFontSize(17)).toBe('17');
    expect(formatFontSize(16.5)).toBe('16.5');
    expect(formatFontSize(16.49)).toBe('16.5');
  });

  it('预设档位都在合法范围内', () => {
    expect(FONT_SIZE_PRESETS.length).toBeGreaterThan(0);
    for (const preset of FONT_SIZE_PRESETS) {
      expect(preset.size).toBeGreaterThanOrEqual(FONT_SIZE_MIN);
      expect(preset.size).toBeLessThanOrEqual(FONT_SIZE_MAX);
      expect(clampFontSize(preset.size)).toBe(preset.size);
    }
  });
});
