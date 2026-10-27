/**
 * 完整性提醒的全局开关。
 *
 * 带原始 HTML / frontmatter 的文档默认会切到源码模式并弹横幅（保护内容不被编辑器丢掉）。
 * 但对经常写这类文档的人来说太吵，所以给一个**一次点击、全局生效**的开关：
 * 用户在横幅上点一次「不再提示（所有 Markdown）」，之后所有文档都直接进可视化。
 *
 * 代价必须写清楚：被丢掉的 HTML 是真的丢，所以「更多」菜单里保留了恢复入口
 * （`restoreIntegrityPrompt`），恢复后新打开的文档会重新提醒。
 */

const KEY = 'airmd.integritySuppressed';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 是否已经关掉了完整性提醒 */
export function isIntegritySuppressed(): boolean {
  try {
    return storage()?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** 关掉提醒；写入失败（隐私模式 / 配额满）时返回 false，下次仍会提示 */
export function suppressIntegrity(): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(KEY, '1');
    return store.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** 恢复提醒 */
export function restoreIntegrityPrompt(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* 忽略：恢复失败最多是继续不提醒 */
  }
}
