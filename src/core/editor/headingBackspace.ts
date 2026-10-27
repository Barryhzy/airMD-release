/**
 * 标题块首按退格 = 直接回到正文。
 *
 * Milkdown 自带的 `downgradeHeadingCommand` 是「逐级降级」：
 * H5 → H4 → H3 …… 必须按五次才回到正文，而语雀、Notion 这类编辑器都是一次到位。
 *
 * 这里不覆盖快捷键绑定（仍是 Backspace / Delete），只把命令实现换掉，
 * 于是块首退格从「降一级」变成「取消标题」。
 */

import type { Editor } from '@milkdown/kit/core';
import { commandsCtx } from '@milkdown/kit/core';
import type { Command } from '@milkdown/kit/prose/state';
import { setBlockType } from '@milkdown/kit/prose/commands';
import { downgradeHeadingCommand } from '@milkdown/kit/preset/commonmark';

export function installHeadingBackspace(editor: Editor): void {
  const toParagraph: Command = (state, dispatch, view) => {
    const { $from, empty } = state.selection;
    // 只在「光标紧贴块首、且没有选中内容」时接管，其余情况交回默认退格行为
    if (!empty || $from.parentOffset !== 0) return false;
    if ($from.parent.type.name !== 'heading') return false;

    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) return false;

    return setBlockType(paragraph)(state, dispatch, view);
  };

  editor.action((ctx) => {
    const commands = ctx.get(commandsCtx);
    // 复用原有的命令 key，等于原地替换实现，keymap 里的绑定不用动
    commands.create(downgradeHeadingCommand.key, () => toParagraph);
  });
}
