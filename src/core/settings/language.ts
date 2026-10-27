import { english } from './messages';

export type Language = 'zh-CN' | 'en';
export const LANGUAGE_STORAGE_KEY = 'airmd.language';

export function readLanguage(): Language {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'zh-CN'; }
  catch { return 'zh-CN'; }
}

// 启动时固定语言，保存设置不重建已打开的文档或改变其撤销历史。
export const interfaceLanguage = readLanguage();
if (typeof document !== 'undefined') document.documentElement.lang = interfaceLanguage;

export function saveLanguage(language: Language): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

export function t(text: string, values: Record<string, string | number> = {}): string {
  const key = text.trim();
  const translated = interfaceLanguage === 'en' ? english[key] ?? key : key;
  const result = key ? text.replace(key, () => translated) : text;
  return result.replace(/\{(\d+)\}/g, (match, index: string) => String(values[index] ?? match));
}

/** Tauri 可能拒绝为字符串；只翻译已知错误前缀，不处理文件名或文档正文。 */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (interfaceLanguage !== 'en') return text;
  if (english[text] !== undefined) return english[text];
  if (text.endsWith(' 是一个目录')) return t('{0} 是一个目录', { '0': text.slice(0, -6) });
  const colon = text.indexOf('：');
  if (colon >= 0 && english[text.slice(0, colon)] !== undefined) {
    const detail = text.slice(colon + 1);
    return `${english[text.slice(0, colon)]}: ${english[detail] ?? detail}`;
  }
  return text;
}
