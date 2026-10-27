import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svgPath = process.argv[2] ?? 'src-tauri/icons/airmd-icon.svg';
const outPath = process.argv[3] ?? 'src-tauri/icons/icon-source-1024.png';
const size = Number(process.argv[4] ?? 1024);
const svg = readFileSync(resolve(svgPath), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
await page.setContent(
  `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg}</div></body>`,
);
await page.evaluate((s) => {
  const el = document.querySelector('svg');
  if (el) {
    el.setAttribute('width', String(s));
    el.setAttribute('height', String(s));
  }
}, size);
await page.locator('svg').screenshot({ path: resolve(outPath), omitBackground: true });
await browser.close();
console.log('written', outPath, size);
