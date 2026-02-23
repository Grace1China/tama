/**
 * 对 Bible Gateway 经文打印页截图，保存为 PNG。
 *
 * 用法: npm run screenshot-passage -- "https://www.biblegateway.com/passage/?search=箴言%202&version=CCB&interface=print"
 * 输出: 默认保存到 scripts/screenshots/箴言-2-CCB.png
 */

import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_URL =
  'https://www.biblegateway.com/passage/?search=%E7%AE%B4%20%E8%A8%80%202&version=CCB&interface=print';

function parseUrl(url: string): { bookName: string; chapter: string; version: string } {
  const u = new URL(url);
  const search = u.searchParams.get('search') || '';
  const version = u.searchParams.get('version') || '';
  const decoded = decodeURIComponent(search).trim();
  const lastSpace = decoded.lastIndexOf(' ');
  const bookName = lastSpace >= 0 ? decoded.slice(0, lastSpace).trim() : decoded;
  const chapter = lastSpace >= 0 ? decoded.slice(lastSpace + 1).trim() : '1';
  return { bookName, chapter, version };
}

async function main() {
  const url = process.argv[2] || DEFAULT_URL;
  const outPathArg = process.argv[3];

  const { bookName, chapter, version } = parseUrl(url);
  const safeName = `${bookName}-${chapter}-${version}`.replace(/[^\w\u4e00-\u9fff-]/g, '-');
  const dir = path.join(__dirname, 'screenshots');
  const defaultPath = path.join(dir, `${safeName}.png`);
  const outPath = outPathArg ? path.resolve(outPathArg) : defaultPath;

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1200 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

    const dirOut = path.dirname(outPath);
    if (!fs.existsSync(dirOut)) {
      fs.mkdirSync(dirOut, { recursive: true });
    }

    const selector = '.passage-col, .passage-content, [class*="passage"], main, #passage-content';
    const el = await page.$(selector);
    if (el) {
      await el.screenshot({ path: outPath, type: 'png' });
    } else {
      await page.screenshot({ path: outPath, type: 'png', fullPage: true });
    }

    console.log('Screenshot saved:', outPath);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
