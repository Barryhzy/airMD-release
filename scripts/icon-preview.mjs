import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svg = readFileSync(resolve('src-tauri/icons/airmd-icon.svg'), 'utf8');
const sized = (s) => svg.replace('width="1024" height="1024"', `width="${s}" height="${s}"`);

const sizes = [256, 128, 64, 32, 16];
const row = (bg, label, color) => `
  <div style="background:${bg};padding:24px 32px;display:flex;align-items:center;gap:28px;border-radius:14px">
    <div style="width:96px;color:${color};font:500 13px/1.4 -apple-system,'Segoe UI',sans-serif">${label}</div>
    ${sizes.map((s) => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px">
      ${sized(s)}
      <span style="color:${color};font:400 11px/1 -apple-system,'Segoe UI',sans-serif;opacity:.65">${s}px</span>
    </div>`).join('')}
  </div>`;

const html = `<body style="margin:0;background:#fff">
  <div style="width:900px;padding:32px;box-sizing:border-box;font-family:-apple-system,'Segoe UI',sans-serif">
    <div style="display:flex;align-items:center;gap:20px;margin-bottom:8px">
      ${sized(96)}
      <div>
        <div style="font:600 30px/1.2 -apple-system,'Segoe UI',sans-serif;color:#1f2329;letter-spacing:-0.02em">airMD</div>
        <div style="font:400 13px/1.6 -apple-system,'Segoe UI',sans-serif;color:#8f959e">轻量 Markdown 编辑器 · 应用图标</div>
      </div>
    </div>
    <div style="height:1px;background:#eef0f3;margin:20px 0 24px"></div>
    <div style="display:flex;flex-direction:column;gap:14px">
      ${row('#f7f8fa', '浅色底', '#1f2329')}
      ${row('#17191c', '深色底', '#e4e6e9')}
    </div>
    <div style="margin-top:22px;color:#8f959e;font:400 12px/1.7 -apple-system,'Segoe UI',sans-serif">
      1024 主图 · 圆角 228（22%）· 渐变 #7FBBFF → #3B7CFF → #1F49CE · 白色 M↓ · 底部两道气流（风）
    </div>
  </div>
</body>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.screenshot({ path: resolve('docs/screenshots/icon-preview.png'), fullPage: true });
await browser.close();
console.log('preview written');
