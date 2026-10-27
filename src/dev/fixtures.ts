import welcome from '../../fixtures/welcome.md?raw';
import withHtml from '../../fixtures/with-html.md?raw';
import withFrontmatter from '../../fixtures/with-frontmatter.md?raw';

export interface DemoFile {
  path: string;
  name: string;
  description: string;
  content: string;
}

/**
 * 浏览器演示模式下的虚拟文件。
 * 桌面版直接读写真实磁盘，不会用到这些内容。
 */
export const DEMO_FILES: DemoFile[] = [
  {
    path: '/demo/示例文档.md',
    name: '示例文档.md',
    description: '展示全部支持的块类型，可安全往返',
    content: welcome,
  },
  {
    path: '/demo/含内嵌HTML.md',
    name: '含内嵌HTML.md',
    description: '会被判定为「无法完整可视化」，默认以源码模式打开',
    content: withHtml,
  },
  {
    path: '/demo/带frontmatter.md',
    name: '带frontmatter.md',
    description: 'YAML 元数据块，同样走源码模式保护',
    content: withFrontmatter,
  },
];
