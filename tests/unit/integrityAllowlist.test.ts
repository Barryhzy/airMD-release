// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  isIntegritySuppressed,
  restoreIntegrityPrompt,
  suppressIntegrity,
} from '../../src/core/settings/integrityAllowlist';

const KEY = 'airmd.integritySuppressed';

describe('完整性提醒的全局开关', () => {
  beforeEach(() => localStorage.clear());

  it('默认开启提醒', () => {
    expect(isIntegritySuppressed()).toBe(false);
  });

  it('关掉之后持久化在 localStorage 里', () => {
    expect(suppressIntegrity()).toBe(true);
    expect(isIntegritySuppressed()).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('重复关闭保持幂等', () => {
    suppressIntegrity();
    suppressIntegrity();
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('可以恢复提醒', () => {
    suppressIntegrity();
    restoreIntegrityPrompt();
    expect(isIntegritySuppressed()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('存储里是脏值 / 清空时按「仍然提醒」处理', () => {
    localStorage.setItem(KEY, 'yes');
    expect(isIntegritySuppressed()).toBe(false);

    localStorage.setItem(KEY, '0');
    expect(isIntegritySuppressed()).toBe(false);
  });
});
