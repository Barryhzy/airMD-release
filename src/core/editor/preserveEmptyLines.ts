import type { Editor } from '@milkdown/kit/core';
import { docSchema } from '@milkdown/kit/preset/commonmark';
import { $node } from '@milkdown/kit/utils';

/** 默认 doc 序列化会删掉最后一个空段落，导致自己保存的 <br /> 再打开时丢失。 */
export async function preserveEmptyLines(editor: Editor, defaultValue: string): Promise<void> {
  const wasEmpty = !defaultValue.trim();
  await editor.remove(docSchema);
  editor.use($node('doc', () => ({
    content: 'block+',
    parseMarkdown: {
      match: ({ type }) => type === 'root',
      runner: (state, node, type) => { state.injectRoot(node, type); },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'doc',
      runner: (state, node) => {
        state.openNode('root');
        // 真正的空文件没有占位符；不要把新建文档的唯一输入段落变成内容。
        if (wasEmpty && node.childCount === 1 &&
          node.firstChild?.type.name === 'paragraph' && node.firstChild.content.size === 0) return;
        state.next(node.content);
      },
    },
  })));
}
