import { describe, expect, it } from 'vitest';
import {
  isExternalUrl,
  relativePathFrom,
  resolveRelativePath,
  sanitizeFileName,
  splitUrlSuffix,
  uniqueFileName,
} from '../../src/core/fs/paths';
import { basename, dirname, extname, isMarkdownPath } from '../../src/core/markdown/codec';

describe('resolveRelativePath', () => {
  it('POSIX 下解析同级与上级', () => {
    expect(resolveRelativePath('/docs/notes', 'a.png')).toBe('/docs/notes/a.png');
    expect(resolveRelativePath('/docs/notes', '../img/a.png')).toBe('/docs/img/a.png');
    expect(resolveRelativePath('/docs/notes', './sub/./a.png')).toBe('/docs/notes/sub/a.png');
  });

  it('Windows 路径保留反斜杠与盘符', () => {
    expect(resolveRelativePath('C:\\docs\\notes', 'a.png')).toBe('C:\\docs\\notes\\a.png');
    expect(resolveRelativePath('C:\\docs\\notes', '..\\img\\a.png')).toBe('C:\\docs\\img\\a.png');
  });

  it('绝对路径原样返回', () => {
    expect(resolveRelativePath('/docs', '/abs/a.png')).toBe('/abs/a.png');
    expect(resolveRelativePath('C:\\docs', 'D:\\a.png')).toBe('D:\\a.png');
  });

  it('不会越出根目录', () => {
    expect(resolveRelativePath('/docs', '../../../../a.png')).toBe('/a.png');
  });
});

describe('relativePathFrom', () => {
  it('同目录只返回文件名', () => {
    expect(relativePathFrom('/docs/notes', '/docs/notes/a.png')).toBe('a.png');
  });

  it('跨目录生成 ../ 前缀', () => {
    expect(relativePathFrom('/docs/notes', '/docs/img/a.png')).toBe('../img/a.png');
  });

  it('Windows 分隔符一致', () => {
    expect(relativePathFrom('C:\\docs\\notes', 'C:\\docs\\notes\\a.png')).toBe('a.png');
  });
});

describe('URL 判定与拆分', () => {
  it('识别外部链接', () => {
    for (const url of ['https://a.com/x.png', 'data:image/png;base64,xx', 'mailto:a@b.c', '#anchor', '//cdn/x.png']) {
      expect(isExternalUrl(url)).toBe(true);
    }
    expect(isExternalUrl('a.png')).toBe(false);
    expect(isExternalUrl('./img/a.png')).toBe(false);
  });

  it('拆分查询串与锚点', () => {
    expect(splitUrlSuffix('a.png?raw=1')).toEqual({ path: 'a.png', suffix: '?raw=1' });
    expect(splitUrlSuffix('a.png#x')).toEqual({ path: 'a.png', suffix: '#x' });
  });
});

describe('文件名处理', () => {
  it('清洗非法字符', () => {
    expect(sanitizeFileName('a/b:c*.png')).toBe('a-b-c-.png');
  });

  it('避免重名', () => {
    expect(uniqueFileName('a.png', [])).toBe('a.png');
    expect(uniqueFileName('a.png', ['a.png'])).toBe('a-1.png');
    expect(uniqueFileName('a.png', ['A.PNG'])).toBe('a-1.png');
  });
});

describe('路径工具', () => {
  it('basename / dirname / extname 兼容两种分隔符', () => {
    expect(basename('C:\\docs\\a.md')).toBe('a.md');
    expect(dirname('C:\\docs\\a.md')).toBe('C:\\docs');
    expect(extname('a.MD')).toBe('.md');
    expect(basename('/docs/a.md')).toBe('a.md');
  });

  it('识别 Markdown 扩展名', () => {
    expect(isMarkdownPath('a.md')).toBe(true);
    expect(isMarkdownPath('a.markdown')).toBe(true);
    expect(isMarkdownPath('a.txt')).toBe(false);
    expect(isMarkdownPath('a')).toBe(false);
  });
});
