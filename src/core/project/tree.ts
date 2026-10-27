import type { ProjectFile } from '../fs/types';

export const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'target', 'dist', '.build-tools']);
export const isMarkdownFile = (path: string): boolean => /\.(md|markdown|mdown|mkd|mkdn|mdx)$/i.test(path);

export interface ProjectNode {
  name: string;
  relativePath: string;
  file?: ProjectFile;
  children: ProjectNode[];
}

/** 一次构造树，文件夹优先；折叠节点不生成 React 行。 */
export function buildProjectTree(files: ProjectFile[]): ProjectNode[] {
  const root: ProjectNode = { name: '', relativePath: '', children: [] };
  const directories = new Map<string, ProjectNode>([['', root]]);
  for (const file of files) {
    const parts = file.relativePath.split('/');
    const name = parts.pop()!;
    let parent = root;
    let relativePath = '';
    for (const part of parts) {
      relativePath = relativePath ? `${relativePath}/${part}` : part;
      let node = directories.get(relativePath);
      if (!node) {
        node = { name: part, relativePath, children: [] };
        directories.set(relativePath, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.children.push({ name, relativePath: file.relativePath, file, children: [] });
  }
  for (const node of directories.values()) {
    node.children.sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  }
  return root.children;
}
