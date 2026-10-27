import { t } from '../settings/language';
/**
 * Markdown 数据完整性校验。
 *
 * 核心思路：不比较「字符」，而是比较「语义」。
 *
 * 做法是把原文和「编辑器回写出来的 Markdown」分别用同一套 CommonMark + GFM 解析器
 * 解析成 mdast，去掉位置信息、合并相邻文本节点后做深度比较。
 *
 * - 语义相同、只有写法差异（`* a` → `- a`、Setext 标题 → ATX 标题）→ 安全。
 * - 语义不同（原文里的 HTML 块、frontmatter 被丢掉）→ 判定为 data-loss，禁止自动覆盖。
 *
 * 这样既能避免把「无害的规范化」误报成危险，也不会让真正的丢失被静默忽略。
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

export type IntegrityRisk = 'none' | 'cosmetic' | 'data-loss';

export interface IntegrityReport {
  risk: IntegrityRisk;
  /** 回写结果是否与原文逐字节相同 */
  identical: boolean;
  /** 原文有、回写结果丢失的节点类型 */
  droppedNodeTypes: string[];
  /** 回写结果新增的节点类型 */
  addedNodeTypes: string[];
  /** 给用户看的说明 */
  notes: string[];
  sourceLength: number;
  outputLength: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type MdNode = { type: string; [key: string]: any };

// 前后一致的解析器：GFM + frontmatter（frontmatter 用来「识别」而不是「支持」）
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']);

const EMPTY_LINE_HTML = /^<br\s*\/?\s*>$/i;

// Milkdown 用独立的 <br /> 保存空白段落；行内 HTML 和带属性的标签仍走源码保护。
function isEmptyLinePlaceholder(node: MdNode, parent?: MdNode): boolean {
  if (node.type !== 'html' || !EMPTY_LINE_HTML.test(node.value ?? '')) return false;
  return ['root', 'blockquote', 'listItem'].includes(parent?.type ?? '') ||
    (parent?.type === 'paragraph' && parent.children?.length === 1);
}

export function parseMarkdown(markdown: string): MdNode {
  return processor.parse(markdown) as unknown as MdNode;
}

/** 文本节点做空白规范化：软换行、多余空格不影响语义 */
function normalizeText(value: string): string {
  return value.replace(/[ \t\r\n]+/g, ' ').trim();
}

function normalizeIdentifier(id: unknown): string {
  return String(id ?? '')
    .trim()
    .toLowerCase();
}

/** 合并相邻文本节点，避免「解析器切分方式不同」造成的假差异 */
function mergeAdjacentText(children: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (const child of children) {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && child.type === 'text') {
      out[out.length - 1] = { ...prev, value: `${prev.value}${child.value}` };
    } else {
      out.push(child);
    }
  }
  return out;
}

interface CanonContext {
  definitions: Map<string, { url: string; title: string }>;
  referenced: Set<string>;
}

function collectDefinitions(root: MdNode): CanonContext {
  const definitions = new Map<string, { url: string; title: string }>();
  const referenced = new Set<string>();

  const walk = (node: MdNode) => {
    if (node.type === 'definition') {
      definitions.set(normalizeIdentifier(node.identifier), {
        url: node.url ?? '',
        title: node.title ?? '',
      });
    }
    if (node.type === 'linkReference' || node.type === 'imageReference' || node.type === 'footnoteReference') {
      referenced.add(normalizeIdentifier(node.identifier));
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children as MdNode[]) walk(child);
    }
  };

  walk(root);
  return { definitions, referenced };
}

/**
 * 引用式链接（`[a][ref]`）与行内链接（`[a](url)`）在语义上是等价的，
 * 因此比较前把它们归一成同一种结构，避免「只是换了写法」被误判为内容丢失。
 */
function canonicalize(node: MdNode, ctx: CanonContext): unknown {
  const out: Record<string, unknown> = { t: node.type };

  switch (node.type) {
    case 'text':
      out.v = normalizeText(node.value ?? '');
      break;
    case 'inlineCode':
      out.v = node.value ?? '';
      break;
    case 'code':
      out.v = node.value ?? '';
      out.lang = node.lang ?? null;
      // meta 会影响代码块渲染（如 ```js title="x"），保留比较
      out.meta = node.meta ?? null;
      break;
    case 'html':
      out.v = EMPTY_LINE_HTML.test(node.value ?? '') ? '<br />' : (node.value ?? '');
      break;
    case 'yaml':
    case 'toml':
    case 'math':
      out.v = node.value ?? '';
      break;
    case 'heading':
      out.d = node.depth;
      break;
    case 'list':
      out.o = Boolean(node.ordered);
      // start 会影响有序列表的渲染数字
      if (node.ordered && Number(node.start) !== 1) out.s = Number(node.start);
      break;
    case 'listItem':
      out.c = node.checked === true;
      break;
    case 'link':
    case 'linkReference': {
      const resolved =
        node.type === 'link'
          ? { url: node.url ?? '', title: node.title ?? '' }
          : (ctx.definitions.get(normalizeIdentifier(node.identifier)) ?? { url: '', title: '' });
      out.t = 'link';
      out.u = resolved.url;
      out.ti = resolved.title;
      break;
    }
    case 'image':
    case 'imageReference': {
      const resolved =
        node.type === 'image'
          ? { url: node.url ?? '', title: node.title ?? '' }
          : (ctx.definitions.get(normalizeIdentifier(node.identifier)) ?? { url: '', title: '' });
      out.t = 'image';
      out.u = resolved.url;
      out.ti = resolved.title;
      out.al = node.alt ?? '';
      break;
    }
    case 'definition':
      out.id = normalizeIdentifier(node.identifier);
      out.u = node.url ?? '';
      out.ti = node.title ?? '';
      break;
    case 'footnoteDefinition':
      out.id = normalizeIdentifier(node.identifier);
      break;
    case 'footnoteReference':
      out.id = normalizeIdentifier(node.identifier);
      break;
    case 'table':
      out.al = (node.align ?? []).map((a: string | null) => a ?? 'default');
      break;
    default:
      break;
  }

  if (Array.isArray(node.children)) {
    const children: unknown[] = [];
    for (const child of mergeAdjacentText(node.children as MdNode[])) {
      // 被引用到的定义已经被内联进 link/image，不再单独参与比较
      if (
        child.type === 'definition' &&
        ctx.referenced.has(normalizeIdentifier((child as MdNode).identifier))
      ) {
        continue;
      }
      children.push(canonicalize(child, ctx));
    }
    out.ch = children;
  }

  return out;
}


/** 找出第一处结构差异，便于定位「到底丢在哪里」 */
function firstDifference(a: unknown, b: unknown, path = 'root'): string | null {
  if (a === b) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return `${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return t("{0}: 数组/对象不一致", { "0": path });
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      if (i >= a.length) return t("{0}[{1}]: 输出新增 {2}", { "0": path, "1": i, "2": nodeLabel(b[i]) });
      if (i >= b.length) return t("{0}[{1}]: 输出缺失 {2}", { "0": path, "1": i, "2": nodeLabel(a[i]) });
      const diff = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  for (const key of keys) {
    if (!(key in objA)) return t("{0}.{1}: 输出新增 {2}", { "0": path, "1": key, "2": JSON.stringify(objB[key]) });
    if (!(key in objB)) return t("{0}.{1}: 输出缺失 {2}", { "0": path, "1": key, "2": JSON.stringify(objA[key]) });
    const diff = firstDifference(objA[key], objB[key], `${path}.${key}`);
    if (diff) return diff;
  }
  return null;
}

function nodeLabel(node: unknown): string {
  if (node && typeof node === 'object' && 't' in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>).t);
  }
  return typeof node;
}


/** 找出第一处结构差异，便于定位「到底丢在哪里」 */
export function canonicalAst(markdown: string): string {
  const root = parseMarkdown(markdown);
  return JSON.stringify(canonicalize(root, collectDefinitions(root)));
}

function countNodeTypes(node: MdNode, acc: Map<string, number> = new Map()): Map<string, number> {
  acc.set(node.type, (acc.get(node.type) ?? 0) + 1);
  if (Array.isArray(node.children)) {
    for (const child of node.children as MdNode[]) countNodeTypes(child, acc);
  }
  return acc;
}

const NODE_LABELS: Record<string, string> = {
  html: t("内嵌 HTML"),
  yaml: t("frontmatter 元数据块"),
  toml: t("TOML 元数据块"),
  footnoteDefinition: t("脚注定义"),
  footnoteReference: t("脚注引用"),
  definition: t("链接引用定义"),
  image: t("图片"),
  imageReference: t("引用式图片"),
  linkReference: t("引用式链接"),
  table: t("表格"),
  code: t("代码块"),
  listItem: t("列表项"),
  blockquote: t("引用块"),
  thematicBreak: t("分隔线"),
  math: t("数学公式"),
};

export function describeNodeType(type: string): string {
  return NODE_LABELS[type] ?? type;
}

/**
 * 判断「原文」经过编辑器回写后是否语义一致。
 *
 * @param source 加载时的原始 Markdown（`\n` 归一化后）
 * @param output 编辑器未做任何编辑时回写出来的 Markdown
 */
export function assessRoundTrip(source: string, output: string): IntegrityReport {
  const identical = source === output;

  let sourceAst: MdNode;
  let outputAst: MdNode;
  try {
    sourceAst = parseMarkdown(source);
    outputAst = parseMarkdown(output);
  } catch (error) {
    return {
      risk: 'data-loss',
      identical,
      droppedNodeTypes: [],
      addedNodeTypes: [],
      notes: [t("Markdown 解析失败：{0}", { "0": (error as Error).message })],
      sourceLength: source.length,
      outputLength: output.length,
    };
  }

  const sourceCanon = JSON.stringify(canonicalize(sourceAst, collectDefinitions(sourceAst)));
  const outputCanon = JSON.stringify(canonicalize(outputAst, collectDefinitions(outputAst)));

  const sourceCounts = countNodeTypes(sourceAst);
  const outputCounts = countNodeTypes(outputAst);

  const droppedNodeTypes: string[] = [];
  const addedNodeTypes: string[] = [];

  for (const [type, count] of sourceCounts) {
    const outCount = outputCounts.get(type) ?? 0;
    if (outCount < count) droppedNodeTypes.push(type);
  }
  for (const [type, count] of outputCounts) {
    const srcCount = sourceCounts.get(type) ?? 0;
    if (srcCount < count) addedNodeTypes.push(type);
  }

  if (identical) {
    return {
      risk: 'none',
      identical,
      droppedNodeTypes,
      addedNodeTypes,
      notes: [],
      sourceLength: source.length,
      outputLength: output.length,
    };
  }

  if (sourceCanon === outputCanon) {
    return {
      risk: 'cosmetic',
      identical,
      droppedNodeTypes,
      addedNodeTypes,
      notes: [t("仅书写风格被规范化（例如列表符号、标题写法），文档语义完全一致。")],
      sourceLength: source.length,
      outputLength: output.length,
    };
  }

  const lost = droppedNodeTypes.filter((t) => !['paragraph', 'text'].includes(t));
  const detail = lost.length
    ? t("可能丢失：{0}。", { "0": lost.map(describeNodeType).join('、') })
    : t("文档结构发生变化。");
  const where = firstDifference(canonicalize(sourceAst, collectDefinitions(sourceAst)), canonicalize(outputAst, collectDefinitions(outputAst)));

  return {
    risk: 'data-loss',
    identical,
    droppedNodeTypes,
    addedNodeTypes,
    notes: [t("可视化编辑器无法完整表达该文档，{0}", { "0": detail }), ...(where ? [t("差异位置：{0}", { "0": where })] : [])],
    sourceLength: source.length,
    outputLength: output.length,
  };
}

export interface UnsupportedFeature {
  type: string;
  label: string;
  count: number;
}

/**
 * 静态扫描「当前编辑器 schema 明确不支持」的语法。
 * 这是启发式的辅助判断，最终结论以 `assessRoundTrip` 为准。
 */
export function scanUnsupportedSyntax(markdown: string): UnsupportedFeature[] {
  const risky = new Set(['html', 'yaml', 'toml']);
  let root: MdNode;
  try {
    root = parseMarkdown(markdown);
  } catch {
    return [];
  }
  const counts = countNodeTypes(root);
  const countUnsupportedHtml = (node: MdNode, parent?: MdNode): number =>
    (node.type === 'html' && !isEmptyLinePlaceholder(node, parent) ? 1 : 0) +
    (node.children ?? []).reduce((sum: number, child: MdNode) => sum + countUnsupportedHtml(child, node), 0);
  counts.set('html', countUnsupportedHtml(root));
  const result: UnsupportedFeature[] = [];
  for (const type of risky) {
    const count = counts.get(type);
    if (count) result.push({ type, label: describeNodeType(type), count });
  }
  return result;
}
