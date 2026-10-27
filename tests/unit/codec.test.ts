import { describe, expect, it } from 'vitest';
import { applyMetaFormatting, decodeDocument, encodeDocument, normalizeEol } from '../../src/core/markdown/codec';
import { countWords } from '../../src/core/doc/stats';

const enc = (s: string) => new TextEncoder().encode(s);

describe('decodeDocument', () => {
  it('识别纯 UTF-8 + LF', () => {
    const { text, meta, warnings } = decodeDocument(enc('# 标题\n\n正文\n'));
    expect(text).toBe('# 标题\n\n正文\n');
    expect(meta.encoding).toBe('utf-8');
    expect(meta.eol).toBe('\n');
    expect(meta.mixedEol).toBe(false);
    expect(meta.trailingNewlines).toBe(1);
    expect(warnings).toHaveLength(0);
  });

  it('识别并保留 CRLF', () => {
    const { text, meta } = decodeDocument(enc('# 标题\r\n\r\n正文\r\n'));
    expect(text).toBe('# 标题\r\n\r\n正文\r\n');
    expect(meta.eol).toBe('\r\n');
    expect(meta.trailingNewlines).toBe(1);
  });

  it('识别并保留 UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('hello\n')]);
    const { text, meta } = decodeDocument(bytes);
    expect(text).toBe('hello\n');
    expect(meta.encoding).toBe('utf-8-bom');
    expect(Array.from(encodeDocument(text, meta))).toEqual(Array.from(bytes));
  });

  it('识别 UTF-16LE', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
    const { text, meta } = decodeDocument(bytes);
    expect(text).toBe('AB');
    expect(meta.encoding).toBe('utf-16le');
    expect(Array.from(encodeDocument(text, meta))).toEqual(Array.from(bytes));
  });

  it('识别 GB18030 并告警', () => {
    // “中文” 的 GB18030 编码
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    const { text, meta, warnings } = decodeDocument(bytes);
    expect(text).toBe('中文');
    expect(meta.encoding).toBe('gb18030');
    expect(warnings.join('')).toContain('GB18030');
  });

  it('标记混用换行', () => {
    const { meta, warnings } = decodeDocument(enc('a\r\nb\nc\n'));
    expect(meta.eol).toBe('\n');
    expect(meta.mixedEol).toBe(true);
    expect(warnings.join('')).toContain('CRLF');
  });

  it('统计文件末尾换行数量', () => {
    expect(decodeDocument(enc('a')).meta.trailingNewlines).toBe(0);
    expect(decodeDocument(enc('a\n')).meta.trailingNewlines).toBe(1);
    expect(decodeDocument(enc('a\n\n')).meta.trailingNewlines).toBe(2);
    expect(decodeDocument(enc('a\r\n\r\n')).meta.trailingNewlines).toBe(2);
  });
});

describe('encodeDocument', () => {
  it('按 meta 还原 CRLF 与末尾换行数量', () => {
    const meta = { encoding: 'utf-8' as const, eol: '\r\n' as const, mixedEol: false, trailingNewlines: 2 };
    expect(applyMetaFormatting('a\nb', meta)).toBe('a\r\nb\r\n\r\n');
  });

  it('不额外添加原文没有的末尾换行', () => {
    const meta = { encoding: 'utf-8' as const, eol: '\n' as const, mixedEol: false, trailingNewlines: 0 };
    const bytes = encodeDocument('# 标题\n', meta);
    expect(new TextDecoder().decode(bytes)).toBe('# 标题');
  });

  it('编辑后仍然复用原有 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('旧\n')]);
    const { meta } = decodeDocument(bytes);
    const out = encodeDocument('新\n', meta);
    expect(out[0]).toBe(0xef);
    expect(new TextDecoder('utf-8').decode(out.subarray(3))).toBe('新\n');
  });

  it('往返不改变字节', () => {
    const samples = [
      'plain text',
      '# 标题\r\n\r\n段落\r\n',
      'a\n\n\n',
      '```js\nconst a = 1;\n```\n',
      '中文内容，带标点。\n',
    ];
    for (const sample of samples) {
      const bytes = enc(sample);
      const { text, meta } = decodeDocument(bytes);
      expect(Array.from(encodeDocument(text, meta))).toEqual(Array.from(bytes));
    }
  });
});

describe('normalizeEol / countWords', () => {
  it('把 CRLF 统一成 LF', () => {
    expect(normalizeEol('a\r\nb\rc', '\n')).toBe('a\nb\nc');
  });

  it('中英文混排字数统计', () => {
    const { words, chars } = countWords('你好 world 世界');
    expect(words).toBe(5);
    expect(chars).toBe(9);
  });
});
