import { t } from '../settings/language';
/**
 * 自动保存策略 —— 纯函数，便于单测覆盖所有边界。
 *
 * 「数据完整性优先于界面美观」在这里落地：
 * 只要存在任何可能覆盖掉用户内容的风险，自动保存就必须停下来，而不是「先写了再说」。
 */

import type { Encoding } from '../markdown/codec';
import { isSafeForDirectWrite } from '../markdown/codec';
import type { IntegrityRisk } from '../markdown/integrity';

export type BlockCode =
  | 'conflict'
  | 'readonly'
  | 'encoding'
  | 'integrity';

export type AutosaveDecision =
  | { action: 'save' }
  | { action: 'skip'; reason: string }
  | { action: 'block'; code: BlockCode; reason: string };

export interface AutosaveInput {
  path: string | null;
  dirty: boolean;
  saving: boolean;
  encoding: Encoding;
  /** 预览模式下算出的完整性结论 */
  integrityRisk: IntegrityRisk;
  /** 用户是否已经明确接受「可视化编辑会丢内容」 */
  integrityAcknowledged: boolean;
  /** 是否检测到其它程序修改了文件且尚未解决 */
  conflict: boolean;
  readonly: boolean;
  autoSaveEnabled: boolean;
  /** 源码模式下文本是权威表示，不经过编辑器回写，因此不受完整性限制 */
  sourceMode: boolean;
}

export function decideAutosave(input: AutosaveInput): AutosaveDecision {
  if (input.saving) return { action: 'skip', reason: t("正在保存中") };
  if (!input.dirty) return { action: 'skip', reason: t("没有改动") };
  if (!input.path) return { action: 'skip', reason: t("尚未保存过的新文档") };

  if (input.conflict) {
    return {
      action: 'block',
      code: 'conflict',
      reason: t("文件已被其它程序修改，自动保存已暂停，请先处理冲突。"),
    };
  }

  if (input.readonly) {
    return {
      action: 'block',
      code: 'readonly',
      reason: t("文件是只读的，无法直接覆盖，请使用「另存为」。"),
    };
  }

  if (!isSafeForDirectWrite(input.encoding)) {
    return {
      action: 'block',
      code: 'encoding',
      reason: t("该文件不是 UTF-8 / UTF-16 编码，直接写回可能破坏编码，自动保存已暂停。"),
    };
  }

  if (!input.sourceMode && input.integrityRisk === 'data-loss' && !input.integrityAcknowledged) {
    return {
      action: 'block',
      code: 'integrity',
      reason: t("可视化编辑器无法完整表达该文档，自动保存已暂停以防内容丢失。"),
    };
  }

  if (!input.autoSaveEnabled) {
    return { action: 'skip', reason: t("自动保存已关闭") };
  }

  return { action: 'save' };
}
