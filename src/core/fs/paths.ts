/**
 * 路径处理 —— 不依赖 Node 的 `path`，以便在浏览器演示模式与测试环境中复用。
 *
 * 需要保证的行为：
 * - 兼容 Windows 反斜杠与 POSIX 斜杠。
 * - 解析 `./`、`../`。
 * - 保留 Windows 盘符。
 * - 对 URL（http/https/data/mailto 等）与锚点原样放行。
 */

const EXTERNAL_URL = /^[a-z][a-z0-9+.-]*:/i;

/** 是否是不需要本地解析的外部引用 */
export function isExternalUrl(url: string): boolean {
  if (!url) return true;
  if (url.startsWith('#')) return true;
  if (url.startsWith('//')) return true;
  return EXTERNAL_URL.test(url);
}

/** 拆分 `path/to/a.png?raw=1#x` 中的查询串与锚点 */
export function splitUrlSuffix(url: string): { path: string; suffix: string } {
  let cut = url.length;
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  if (q !== -1) cut = Math.min(cut, q);
  if (h !== -1) cut = Math.min(cut, h);
  return { path: url.slice(0, cut), suffix: url.slice(cut) };
}

function detectSeparator(p: string): string {
  return p.includes('\\') && !p.includes('/') ? '\\' : '/';
}

function splitSegments(p: string): string[] {
  return p.split(/[\\/]+/).filter((s) => s.length > 0);
}

function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('\\');
}

/**
 * 把 `relative` 解析到 `baseDir` 之下。
 * 若 `relative` 本身是绝对路径，直接返回它。
 */
export function resolveRelativePath(baseDir: string, relative: string): string {
  if (!relative) return baseDir;
  if (isAbsolutePath(relative)) return relative.replace(/[\\/]+/g, detectSeparator(relative));

  const sep = detectSeparator(baseDir);
  const base = splitSegments(baseDir);
  const parts = splitSegments(relative);

  let drive = '';
  if (base.length > 0 && /^[a-zA-Z]:$/.test(base[0])) {
    drive = base.shift() as string;
  }

  const stack = [...base];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(part);
  }

  const prefix = drive ? `${drive}${sep}` : baseDir.startsWith('/') || baseDir.startsWith('\\') ? sep : '';
  return prefix + stack.join(sep);
}

/** 生成从 `baseDir` 指向 `target` 的相对路径（同目录时只返回文件名） */
export function relativePathFrom(baseDir: string, target: string): string {
  const sep = detectSeparator(baseDir);
  const base = splitSegments(baseDir);
  const tgt = splitSegments(target);

  let i = 0;
  while (i < base.length && i < tgt.length && base[i] === tgt[i]) i += 1;
  const up = new Array(base.length - i).fill('..');
  const down = tgt.slice(i);
  const rel = [...up, ...down].join(sep);
  return rel || tgt[tgt.length - 1] || '';
}

/** 生成一个不会覆盖已有文件的文件名 */
export function uniqueFileName(desired: string, existing: readonly string[]): string {
  const set = new Set(existing.map((e) => e.toLowerCase()));
  if (!set.has(desired.toLowerCase())) return desired;
  const dot = desired.lastIndexOf('.');
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : '';
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!set.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/** 把文件名里的非法字符替换掉 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'image';
}
