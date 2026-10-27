import { describe, expect, it } from 'vitest';
import {
  assessRoundTrip,
  canonicalAst,
  describeNodeType,
  scanUnsupportedSyntax,
} from '../../src/core/markdown/integrity';

describe('语义往返判定', () => {
  it('完全相同 → none', () => {
    const doc = '# 标题\n\n段落内容。\n';
    const report = assessRoundTrip(doc, doc);
    expect(report.risk).toBe('none');
    expect(report.identical).toBe(true);
  });

  it('列表符号从 * 变 - → 只有书写风格差异（cosmetic）', () => {
    const source = '* 第一项\n* 第二项\n';
    const output = '- 第一项\n- 第二项\n';
    const report = assessRoundTrip(source, output);
    expect(report.risk).toBe('cosmetic');
    expect(report.identical).toBe(false);
  });

  it('Setext 标题变 ATX 标题 → cosmetic', () => {
    const report = assessRoundTrip('标题\n====\n\n正文\n', '# 标题\n\n正文\n');
    expect(report.risk).toBe('cosmetic');
  });

  it('引用式链接被展开成行内链接 → cosmetic', () => {
    const source = '看这个 [链接][ref]。\n\n[ref]: https://example.com\n';
    const output = '看这个 [链接](https://example.com)。\n\n';
    expect(assessRoundTrip(source, output).risk).toBe('cosmetic');
  });

  it('HTML 块被丢弃 → data-loss', () => {
    const source = '# 标题\n\n<div class="x">内容</div>\n\n正文\n';
    const output = '# 标题\n\n正文\n';
    const report = assessRoundTrip(source, output);
    expect(report.risk).toBe('data-loss');
    expect(report.droppedNodeTypes).toContain('html');
    expect(report.notes.join('')).toContain('内嵌 HTML');
  });

  it('frontmatter 被丢弃 → data-loss', () => {
    const source = '---\ntitle: 标题\n---\n\n正文\n';
    const output = '正文\n';
    const report = assessRoundTrip(source, output);
    expect(report.risk).toBe('data-loss');
    expect(report.droppedNodeTypes).toContain('yaml');
  });

  it('代码块丢失语言标记 → data-loss', () => {
    const report = assessRoundTrip('```ts\nconst a = 1;\n```\n', '```\nconst a = 1;\n```\n');
    expect(report.risk).toBe('data-loss');
  });

  it('代码块丢失 meta 信息 → data-loss', () => {
    const report = assessRoundTrip('```js title="a"\nconst a = 1;\n```\n', '```js\nconst a = 1;\n```\n');
    expect(report.risk).toBe('data-loss');
  });

  it('文字被改写 → data-loss', () => {
    expect(assessRoundTrip('# 标题\n', '# 标题改过了\n').risk).toBe('data-loss');
  });

  it('任务清单勾选状态变了 → data-loss', () => {
    expect(assessRoundTrip('- [ ] 待办\n', '- [x] 待办\n').risk).toBe('data-loss');
  });

  it('表格对齐信息变化 → data-loss', () => {
    const source = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    const output = '| a | b |\n| :--- | ---: |\n| 1 | 2 |\n';
    expect(assessRoundTrip(source, output).risk).toBe('data-loss');
  });

  it('只有软换行差异 → cosmetic', () => {
    expect(assessRoundTrip('第一行\n第二行\n', '第一行 第二行\n').risk).toBe('cosmetic');
  });

  it('图片路径变化 → data-loss', () => {
    expect(assessRoundTrip('![a](x.png)\n', '![a](y.png)\n').risk).toBe('data-loss');
  });

  it('解析失败不抛异常', () => {
    expect(() => assessRoundTrip('```\n未闭合代码块\n', '```\n未闭合代码块\n')).not.toThrow();
  });
});

describe('canonicalAst', () => {
  it('忽略位置信息', () => {
    expect(canonicalAst('# a\n')).toBe(canonicalAst('# a\n\n\n'));
  });

  it('区分不同深度的标题', () => {
    expect(canonicalAst('# a\n')).not.toBe(canonicalAst('## a\n'));
  });
});

describe('scanUnsupportedSyntax', () => {
  it.each(['<br>', '<br/>', '<br />', '<BR>', '<br  />'])('独立空行标记 %s 不误报 HTML', (br) => {
    expect(scanUnsupportedSyntax(`# 标题\n\n${br}\n\n正文\n\n${br}\n`)).toEqual([]);
    expect(assessRoundTrip(`正文\n\n${br}\n`, '正文\n\n<br />\n').risk).not.toBe('data-loss');
  });

  it('引用和列表中的空白段落不误报', () => {
    expect(scanUnsupportedSyntax('> <br />\n\n- <br />\n')).toEqual([]);
  });

  it('带属性的换行和行内 HTML 仍保留保护', () => {
    for (const markdown of ['<br class="x">\n', '前<br />后\n', '<br />\n<div>内容</div>\n', '| a |\n| --- |\n| <br /> |\n']) {
      expect(scanUnsupportedSyntax(markdown).map((f) => f.type)).toContain('html');
    }
  });

  it('空行标记被删除仍判定为内容丢失', () => {
    expect(assessRoundTrip('正文\n\n<br />\n', '正文\n').risk).toBe('data-loss');
    expect(assessRoundTrip('<br />\n\n<br />\n', '<br />\n').risk).toBe('data-loss');
  });

  it('检出内嵌 HTML', () => {
    const found = scanUnsupportedSyntax('<div>x</div>\n');
    expect(found.map((f) => f.type)).toContain('html');
  });

  it('检出 frontmatter', () => {
    const found = scanUnsupportedSyntax('---\na: 1\n---\n\n正文\n');
    expect(found.map((f) => f.type)).toContain('yaml');
  });

  it('普通文档不误报', () => {
    expect(scanUnsupportedSyntax('# 标题\n\n- a\n- b\n\n> 引用\n')).toHaveLength(0);
  });
});

describe('describeNodeType', () => {
  it('给出中文名称', () => {
    expect(describeNodeType('html')).toBe('内嵌 HTML');
    expect(describeNodeType('unknown_type')).toBe('unknown_type');
  });
});
