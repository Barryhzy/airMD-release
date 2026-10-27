import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { cellAround } from '@milkdown/kit/prose/tables';

/** 单击单元格直接编辑，避免 Crepe 延迟设置的块选区覆盖后续输入/全选。 */
export function createTableCellEditingPlugin(): Plugin {
  return new Plugin({
    view(view) {
      const enterCell = (event: MouseEvent) => {
        if (!view.editable || view.composing || event.button !== 0 ||
          event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target;
        if (!(target instanceof Element) || target.closest('button')) return;
        const cell = target.closest('td, th');
        if (!cell || !view.dom.contains(cell)) return;
        const $cell = cellAround(view.state.doc.resolve(view.posAtDOM(cell, 0)));
        if (!$cell) return;
        const current = cellAround(view.state.selection.$from);
        if (view.state.selection instanceof TextSelection && current?.pos === $cell.pos) return;
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve($cell.pos + 1))));
      };
      // NodeView.stopEvent 在普通 DOM handler 之前运行，必须先在捕获阶段放置文本光标。
      view.dom.addEventListener('pointerdown', enterCell, true);
      view.dom.addEventListener('mousedown', enterCell, true);
      return { destroy() {
        view.dom.removeEventListener('pointerdown', enterCell, true);
        view.dom.removeEventListener('mousedown', enterCell, true);
      } };
    },
  });
}
