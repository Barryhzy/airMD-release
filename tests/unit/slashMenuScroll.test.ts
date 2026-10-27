import { describe, expect, it } from 'vitest';
import { computeFollowScrollTop } from '../../src/core/editor/slashMenuScroll';

// 与线上一致：容器可视高 420、行高 52，中线在 210
const base = {
  itemHeight: 52,
  viewportHeight: 420,
  scrollTop: 0,
  scrollHeight: 886,
};

describe('斜杠菜单的滚动跟随', () => {
  it('选中项落在中线附近时不动', () => {
    expect(computeFollowScrollTop({ ...base, itemTop: 210 - 26 })).toBe(0);
  });

  it('仍在可视区上半部分时不动，让高亮自己往下走', () => {
    // 条目中心在 74 / 126，都还没到中线
    expect(computeFollowScrollTop({ ...base, itemTop: 48 })).toBe(0);
    expect(computeFollowScrollTop({ ...base, itemTop: 100 })).toBe(0);
  });

  it('越过中线后按差值跟随，把选中项拉回中线', () => {
    // 中心 242 → 比中线低 32，需要向下滚 32
    expect(computeFollowScrollTop({ ...base, itemTop: 216 })).toBe(32);
    // 已经滚过一段时在原值上累加
    expect(computeFollowScrollTop({ ...base, itemTop: 236, scrollTop: 100 })).toBe(152);
  });

  it('向上越过中线时反向跟随', () => {
    expect(computeFollowScrollTop({ ...base, itemTop: 100, scrollTop: 200 })).toBe(116);
  });

  it('顶部不越界', () => {
    expect(computeFollowScrollTop({ ...base, itemTop: 48, scrollTop: 20 })).toBe(0);
    expect(computeFollowScrollTop({ ...base, itemTop: -400, scrollTop: 10 })).toBe(0);
  });

  it('底部不越界', () => {
    const max = 886 - 420;
    expect(computeFollowScrollTop({ ...base, itemTop: 900, scrollTop: max })).toBe(max);
  });

  it('尺寸未知时保持原值', () => {
    expect(computeFollowScrollTop({ ...base, itemTop: 100, itemHeight: 0, scrollTop: 50 })).toBe(50);
    expect(computeFollowScrollTop({ ...base, itemTop: 100, viewportHeight: 0, scrollTop: 50 })).toBe(50);
  });
});
