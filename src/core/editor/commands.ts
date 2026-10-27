/**
 * 编辑器命令层。
 *
 * 统一用 ProseMirror 原生命令实现，避免依赖 Crepe 内部菜单的私有实现，
 * 这样工具栏、段落菜单、快捷键三条入口的行为保持一致。
 */

import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';
import { lift, setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands';
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list';
import { createTable } from '@milkdown/kit/preset/gfm';
import { redo, redoDepth, undo, undoDepth } from '@milkdown/kit/prose/history';
import type { EditorView } from '@milkdown/kit/prose/view';

export type BlockKind =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'codeBlock';

export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  paragraph: '正文',
  h1: '标题 1',
  h2: '标题 2',
  h3: '标题 3',
  h4: '标题 4',
  h5: '标题 5',
  h6: '标题 6',
  quote: '引用',
  bulletList: '无序列表',
  orderedList: '有序列表',
  taskList: '待办清单',
  codeBlock: '代码块',
};

export const TEXT_BLOCK_KINDS: BlockKind[] = [
  'paragraph',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'quote',
  'codeBlock',
];

export const LIST_BLOCK_KINDS: BlockKind[] = ['bulletList', 'orderedList', 'taskList'];

export interface ActiveStates {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  inlineCode: boolean;
  link: boolean;
  block: BlockKind;
  canUndo: boolean;
  canRedo: boolean;
}

export const EMPTY_ACTIVE: ActiveStates = {
  bold: false,
  italic: false,
  strike: false,
  inlineCode: false,
  link: false,
  block: 'paragraph',
  canUndo: false,
  canRedo: false,
};

type Dispatch = (tr: Transaction) => void;
type Cmd = (state: EditorState, dispatch?: Dispatch, view?: EditorView) => boolean;

function ancestors(state: EditorState): Set<string> {
  const names = new Set<string>();
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    names.add($from.node(depth).type.name);
  }
  return names;
}

function isMarkActive(state: EditorState, name: string): boolean {
  const type = state.schema.marks[name];
  if (!type) return false;
  const { from, $from, to, empty } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

function blockLevelOf(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'heading') return Number(node.attrs.level);
  }
  return null;
}

function currentListItem(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'list_item') return node;
  }
  return null;
}

function isTaskItem(state: EditorState): boolean {
  const item = currentListItem(state);
  if (!item) return false;
  return item.attrs.checked === false || item.attrs.checked === true;
}

export function computeActiveStates(editor: Editor | null): ActiveStates {
  if (!editor) return EMPTY_ACTIVE;
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const names = ancestors(state);

    let block: BlockKind = 'paragraph';
    if (names.has('code_block')) {
      block = 'codeBlock';
    } else if (names.has('blockquote')) {
      block = 'quote';
    } else if (names.has('list_item')) {
      if (isTaskItem(state)) block = 'taskList';
      else block = names.has('ordered_list') ? 'orderedList' : 'bulletList';
    } else {
      const level = blockLevelOf(state);
      if (level) block = `h${level}` as BlockKind;
    }

    return {
      bold: isMarkActive(state, 'strong'),
      italic: isMarkActive(state, 'emphasis'),
      strike: isMarkActive(state, 'strike_through'),
      inlineCode: isMarkActive(state, 'inlineCode'),
      link: isMarkActive(state, 'link'),
      block,
      canUndo: undoDepth(state) > 0,
      canRedo: redoDepth(state) > 0,
    };
  });
}

/** 读取指定位置的块类型，用于在块菜单里标出「当前样式」 */
export function blockKindAt(editor: Editor | null, pos: number): BlockKind | null {
  if (!editor || pos < 0) return null;
  return editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc;
    if (pos >= doc.content.size) return null;
    const node = doc.nodeAt(pos);
    if (!node) return null;

    switch (node.type.name) {
      case 'heading':
        return `h${Number(node.attrs.level)}` as BlockKind;
      case 'code_block':
        return 'codeBlock';
      case 'blockquote':
        return 'quote';
      case 'ordered_list':
        return 'orderedList';
      case 'bullet_list': {
        // 待办清单在 schema 里就是带 checked 的 bullet_list
        const checked = node.firstChild?.attrs?.checked;
        return checked === true || checked === false ? 'taskList' : 'bulletList';
      }
      case 'paragraph':
        return 'paragraph';
      default:
        return null;
    }
  });
}

/** 段落级操作：再次点击当前类型 = 退回正文 */
export function applyBlock(editor: Editor, kind: BlockKind): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const schema = ctx.get(schemaCtx);
    const run = (cmd: Cmd) => cmd(view.state, view.dispatch.bind(view) as Dispatch, view);

    const names = ancestors(view.state);
    const inList = names.has('list_item');
    const paragraph = schema.nodes.paragraph!;
    const listItem = schema.nodes.list_item!;

    const outdentList = () => {
      if (inList && listItem) run(liftListItem(listItem));
    };

    const toList = (listTypeName: 'bullet_list' | 'ordered_list', task: boolean) => {
      const listType = schema.nodes[listTypeName];
      if (!listType) return;
      outdentList();
      run(wrapInList(listType));
      if (!task) return;
      const state = view.state;
      const tr = state.tr;
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.type.name === 'list_item') {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
        }
        return true;
      });
      if (tr.docChanged) view.dispatch(tr);
    };

    switch (kind) {
      case 'paragraph':
        if (inList) outdentList();
        else run(setBlockType(paragraph));
        break;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const level = Number(kind.slice(1));
        if (blockLevelOf(view.state) === level) run(setBlockType(paragraph));
        else run(setBlockType(schema.nodes.heading!, { level }));
        break;
      }
      case 'quote':
        if (names.has('blockquote')) run(lift);
        else run(wrapIn(schema.nodes.blockquote!));
        break;
      case 'bulletList':
        if (names.has('bullet_list') && !isTaskItem(view.state)) outdentList();
        else toList('bullet_list', false);
        break;
      case 'orderedList':
        if (names.has('ordered_list')) outdentList();
        else toList('ordered_list', false);
        break;
      case 'taskList':
        if (isTaskItem(view.state)) outdentList();
        else toList('bullet_list', true);
        break;
      case 'codeBlock':
        run(setBlockType(schema.nodes.code_block!));
        break;
      default:
        break;
    }

    view.focus();
  });
}

export function applyMark(
  editor: Editor,
  mark: 'strong' | 'emphasis' | 'strike_through' | 'inlineCode',
): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const type = view.state.schema.marks[mark];
    if (!type) return;
    toggleMark(type)(view.state, view.dispatch.bind(view) as Dispatch, view);
    view.focus();
  });
}

/** 找出光标所在位置的那一段连续链接范围（链接不会跨块，扫当前段落的子节点即可） */
function linkRangeAtCursor(state: EditorState): { from: number; to: number } | null {
  const type = state.schema.marks.link;
  if (!type) return null;
  const { $from } = state.selection;
  const mark = type.isInSet($from.marks());
  if (!mark) return null;

  const base = $from.start();
  let start = -1;
  let end = -1;

  $from.parent.forEach((node, offset) => {
    const nodeFrom = base + offset;
    const nodeTo = nodeFrom + node.nodeSize;
    const hasMark = Boolean(type.isInSet(node.marks));
    if (hasMark) {
      if (start === -1) start = nodeFrom;
      end = nodeTo;
    } else if (start !== -1 && $from.pos < nodeFrom) {
      // 已经离开链接之后，不再向后延伸
      return false;
    }
    return true;
  });

  return start >= 0 && end > start ? { from: start, to: end } : null;
}

export function applyLink(editor: Editor, href: string | null): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const type = view.state.schema.marks.link;
    if (!type) return;
    const { state } = view;
    const { empty, from, to } = state.selection;

    // 空 href：移除链接。有选区就移除选区内的，没有选区就移除光标所在的整段链接
    if (!href) {
      const range = empty ? linkRangeAtCursor(state) : { from, to };
      if (!range) return;
      view.dispatch(state.tr.removeMark(range.from, range.to, type));
      view.focus();
      return;
    }

    // 没有选中文字：直接把链接文字插入到光标处，否则用户看不到任何变化
    if (empty) {
      const label = href.replace(/^https?:\/\//i, '').replace(/\/$/, '') || href;
      const mark = type.create({ href, title: null });
      const tr = state.tr.insertText(label, from).addMark(from, from + label.length, mark);
      tr.setSelection(TextSelection.near(tr.doc.resolve(from + label.length)));
      view.dispatch(tr);
      view.focus();
      return;
    }

    toggleMark(type, { href, title: null })(state, view.dispatch.bind(view) as Dispatch, view);
    view.focus();
  });
}

export function applyUndo(editor: Editor): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    undo(view.state, view.dispatch.bind(view) as Dispatch, view);
    view.focus();
  });
}

export function applyRedo(editor: Editor): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    redo(view.state, view.dispatch.bind(view) as Dispatch, view);
    view.focus();
  });
}

export function insertHorizontalRule(editor: Editor): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const hr = state.schema.nodes.hr;
    if (!hr) return;
    const tr = state.tr.replaceSelectionWith(hr.create(), false);
    const paragraph = state.schema.nodes.paragraph?.create();
    if (paragraph) {
      const at = tr.selection.to;
      tr.insert(at, paragraph);
      tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
    }
    view.dispatch(tr.scrollIntoView());
    view.focus();
  });
}

/**
 * 插入表格。
 *
 * 必须用 GFM 预设自带的 `createTable`：它的 schema 里表格的 content 是
 * `table_header_row table_row+`，第一行是**独立的 table_header_row 节点**，
 * 不是「装了 table_header 的 table_row」。手搓节点会得到一个 schema 非法的表格 ——
 * 表面上能显示，但一旦触发 ProseMirror 的内容校验（退格删除、拖动、合并单元格）
 * 就会抛 `Called contentMatchAt on a node with invalid content`，整个编辑器随后失效。
 */
export function insertTable(editor: Editor, rows = 3, cols = 3): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const { from } = state.selection;
    const table = createTable(ctx, Math.max(2, rows), Math.max(1, cols));

    // 和 Milkdown 自己的 insertTableCommand 一致：块级节点插进段落时会自动把段落切开，
    // 表格前后各留一个空段落，不需要再手工补（手工按 from + nodeSize 算位置会错）。
    const tr = state.tr.replaceSelectionWith(table);
    const inside = Selection.findFrom(tr.doc.resolve(from), 1, true);
    if (inside) tr.setSelection(inside);

    view.dispatch(tr.scrollIntoView());
    view.focus();
  });
}

export function insertImage(editor: Editor, src: string, alt = ''): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const image = state.schema.nodes.image;
    if (image) {
      const tr = state.tr.replaceSelectionWith(image.create({ src, alt, title: null }), false);
      view.dispatch(tr.scrollIntoView());
    }
    view.focus();
  });
}

/** 当前选区所在顶层块的起始位置与大小，用于后续块级操作 */
export function topLevelBlock(editor: Editor): { pos: number; size: number; index: number } | null {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { $from } = view.state.selection;
    let depth = $from.depth;
    while (depth > 1) depth -= 1;
    if (depth < 1) return null;
    return { pos: $from.before(depth), size: $from.node(depth).nodeSize, index: depth };
  });
}
