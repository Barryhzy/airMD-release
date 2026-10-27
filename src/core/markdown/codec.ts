import { t } from '../settings/language';
/**
 * 文本编解码层 —— 负责「磁盘字节」与「编辑器字符串」之间的忠实转换。
 *
 * 设计原则：
 * 1. 编辑器内部永远只处理 `\n` 换行，磁盘上的换行风格在读写边界转换。
 * 2. 编码、BOM、行尾、文件末尾换行数量全部记录在 `TextMeta` 中，保存时原样还原。
 * 3. 无法可靠重新编码的文档（GB18030 / 未知编码）不会被自动保存覆盖。
 */

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'unknown';

export type Eol = '\n' | '\r\n';

export interface TextMeta {
  /** 源文件编码 */
  encoding: Encoding;
  /** 主要换行风格 */
  eol: Eol;
  /** 是否混用了 CRLF 与 LF */
  mixedEol: boolean;
  /** 文件末尾换行符个数（0 / 1 / 2…），保存时还原 */
  trailingNewlines: number;
}

export interface DecodedDocument {
  /** 归一化为 `\n` 之后的文本 */
  text: string;
  meta: TextMeta;
  /** 解码过程中的告警，用于提示用户 */
  warnings: string[];
}

export const DEFAULT_META: TextMeta = {
  encoding: 'utf-8',
  eol: '\n',
  mixedEol: false,
  trailingNewlines: 0,
};

const BOM_UTF8 = new Uint8Array([0xef, 0xbb, 0xbf]);

function hasBom(bytes: Uint8Array, bom: Uint8Array): boolean {
  if (bytes.length < bom.length) return false;
  for (let i = 0; i < bom.length; i += 1) {
    if (bytes[i] !== bom[i]) return false;
  }
  return true;
}

/** UTF-8 兼容编码（含 BOM 变体）才允许「原样回写」 */
export function isUtf8Compatible(encoding: Encoding): boolean {
  return encoding === 'utf-8' || encoding === 'utf-8-bom';
}

/** 该编码是否允许自动保存（会直接覆盖原文件） */
export function isSafeForDirectWrite(encoding: Encoding): boolean {
  return isUtf8Compatible(encoding) || encoding === 'utf-16le' || encoding === 'utf-16be';
}

function detectEol(text: string): { eol: Eol; mixed: boolean } {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      if (i > 0 && text.charCodeAt(i - 1) === 13 /* \r */) crlf += 1;
      else lf += 1;
    }
  }
  const eol: Eol = crlf > lf ? '\r\n' : '\n';
  return { eol, mixed: crlf > 0 && lf > 0 };
}

function countTrailingNewlines(text: string): number {
  let i = text.length - 1;
  let count = 0;
  while (i >= 0) {
    const code = text.charCodeAt(i);
    if (code === 10 /* \n */) {
      // CRLF 整体算一个换行
      if (i > 0 && text.charCodeAt(i - 1) === 13 /* \r */) i -= 1;
      count += 1;
      i -= 1;
    } else if (code === 13 /* \r */) {
      count += 1;
      i -= 1;
    } else {
      break;
    }
  }
  return count;
}

/**
 * 将磁盘字节解码为编辑器文本。
 * 绝不抛异常：无法识别的编码会退化为 UTF-8 + 替换字符，并标记编码不可安全回写。
 */
export function decodeDocument(bytes: Uint8Array): DecodedDocument {
  const warnings: string[] = [];
  let encoding: Encoding = 'utf-8';
  let offset = 0;
  let text: string | null = null;

  if (hasBom(bytes, BOM_UTF8)) {
    encoding = 'utf-8-bom';
    offset = 3;
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    offset = 2;
  }

  const body = bytes.subarray(offset);

  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    try {
      const candidate = new TextDecoder(encoding).decode(body);
      // 合法的 UTF-16 文本不应出现替换字符；出现则说明 BOM 是假阳性
      if (!candidate.includes('\uFFFD')) text = candidate;
    } catch {
      // 忽略，走 UTF-8 分支
    }
    if (text === null) {
      encoding = 'utf-8';
      offset = 0;
    }
  }

  if (text === null) {
    const raw = bytes.subarray(offset);
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      // 不是合法 UTF-8，尝试中文常见编码
      let decoded: string | null = null;
      try {
        decoded = new TextDecoder('gb18030', { fatal: true }).decode(raw);
      } catch {
        decoded = null;
      }
      if (decoded !== null) {
        encoding = 'gb18030';
        text = decoded;
        warnings.push(
          t("该文件不是 UTF-8 编码，已按 GB18030 解码。为避免破坏原编码，自动保存已暂停，可使用「另存为 UTF-8」。"),
        );
      } else {
        encoding = 'unknown';
        text = new TextDecoder('utf-8').decode(raw);
        warnings.push(t("无法识别该文件的文本编码，内容可能显示为乱码。已禁止自动保存，请使用「另存为」。"));
      }
    }
  }

  const { eol, mixed } = detectEol(text);
  if (mixed) {
    warnings.push(
      t("文件混用了 CRLF 与 LF 换行，保存时将统一为 {0}。", { "0": eol === '\r\n' ? 'CRLF' : 'LF' }),
    );
  }

  return {
    text,
    meta: {
      encoding,
      eol,
      mixedEol: mixed,
      trailingNewlines: countTrailingNewlines(text),
    },
    warnings,
  };
}

/** 把任意换行风格统一为 `\n`（用于把磁盘文本交给编辑器前的兜底处理） */
export function normalizeEol(text: string, eol: Eol): string {
  const unified = text.replace(/\r\n?/g, '\n');
  return eol === '\r\n' ? unified.replace(/\n/g, '\r\n') : unified;
}

function stripTrailingNewlines(text: string): string {
  return text.replace(/(\r\n|\n|\r)+$/, '');
}

/** 按 `meta` 还原行尾风格与文件末尾换行数量 */
export function applyMetaFormatting(text: string, meta: TextMeta): string {
  const unified = text.replace(/\r\n?/g, '\n');
  const withTrailing = stripTrailingNewlines(unified) + '\n'.repeat(meta.trailingNewlines);
  return meta.eol === '\r\n' ? withTrailing.replace(/\n/g, '\r\n') : withTrailing;
}

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const lo = code & 0xff;
    const hi = (code >> 8) & 0xff;
    out[i * 2] = littleEndian ? lo : hi;
    out[i * 2 + 1] = littleEndian ? hi : lo;
  }
  return out;
}

/**
 * 将编辑器文本编码回磁盘字节。
 * GB18030 / unknown 无法安全回写，退化为 UTF-8（调用方应已通过策略阻止该路径）。
 */
export function encodeDocument(text: string, meta: TextMeta): Uint8Array {
  const formatted = applyMetaFormatting(text, meta);

  if (meta.encoding === 'utf-16le' || meta.encoding === 'utf-16be') {
    const body = encodeUtf16(formatted, meta.encoding === 'utf-16le');
    const withBom = new Uint8Array(body.length + 2);
    withBom.set(meta.encoding === 'utf-16le' ? [0xff, 0xfe] : [0xfe, 0xff], 0);
    withBom.set(body, 2);
    return withBom;
  }

  const body = new TextEncoder().encode(formatted);
  if (meta.encoding === 'utf-8-bom') {
    const withBom = new Uint8Array(body.length + 3);
    withBom.set(BOM_UTF8, 0);
    withBom.set(body, 3);
    return withBom;
  }
  return body;
}

/** 从路径中提取用于展示的文件名（不依赖 Node path，兼容 Web 环境） */
export function basename(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/** 提取父目录，保留原有的分隔符风格 */
export function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (idx < 0) return '.';
  if (idx === 0) return p.slice(0, 1);
  return p.slice(0, idx);
}

export function extname(p: string): string {
  const name = basename(p);
  const idx = name.lastIndexOf('.');
  return idx <= 0 ? '' : name.slice(idx).toLowerCase();
}

/** 是否是被支持的 Markdown 扩展名 */
export function isMarkdownPath(p: string): boolean {
  return ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx'].includes(extname(p));
}
