/** 字数统计：中文按字计，英文按词计，与主流编辑器口径一致 */

export interface TextStats {
  words: number;
  chars: number;
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
const LATIN = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

export function countWords(text: string): TextStats {
  const chars = text.replace(/\s/g, '').length;
  const cjk = (text.match(CJK) ?? []).length;
  const latin = (text.match(LATIN) ?? []).length;
  return { words: cjk + latin, chars };
}
