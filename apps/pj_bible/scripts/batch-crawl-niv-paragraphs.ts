/**
 * 批量爬取 NIV 版本段落信息
 * - 从 data/books.csv 取 english 作为 URL 的 book 和输出文件名
 * - 从 data/bible-niv.json 取每本书的 chapters[].id 作为 chapter
 * - URL: https://www.biblegateway.com/passage/?search={book}{chapter}&version=niv&interface=print
 * - 输出: data/biblePara/niv/{book}.csv，记录 book,chapter,paragraph,title,startVerseNo,endVerseNo
 *
 * 用法: npm run batch-crawl-niv-paragraphs
 */

import * as fs from 'fs';
import * as path from 'path';
import { crawlPassage, ParagraphRecord } from './crawl-biblegateway';

interface BookNiv {
  id: string;
  title: string;
  chapters: Array<{ id: number }>;
}

interface BibleNiv {
  version: string;
  books: BookNiv[];
}

interface BookCsvRow {
  order: number;
  english: string;
}

/**
 * 解析 books.csv，按 order 排序返回 english 数组
 */
function loadBooksCsv(): BookCsvRow[] {
  const filePath = path.join(__dirname, '..', 'data', 'books.csv');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) throw new Error('books.csv 为空或仅有表头');
  const rows: BookCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length >= 2) {
      rows.push({
        order: parseInt(parts[0].trim(), 10),
        english: parts[1].trim(),
      });
    }
  }
  rows.sort((a, b) => a.order - b.order);
  return rows;
}

/**
 * 加载 bible-niv.json
 */
function loadBibleNiv(): BibleNiv {
  const filePath = path.join(__dirname, '..', 'data', 'bible-niv.json');
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * 构建 Bible Gateway NIV URL
 */
function buildNivUrl(bookEnglish: string, chapter: number): string {
  const search = `${bookEnglish} ${chapter}`;
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(search)}&version=niv&interface=print`;
}

/**
 * 随机延迟（防止反爬虫）
 */
function randomDelay(minSeconds: number = 1, maxSeconds: number = 3): Promise<void> {
  const span = (maxSeconds - minSeconds) * 1000;
  const delayMs = minSeconds * 1000 + Math.floor(Math.random() * span);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * 写入 CSV 表头；追加记录
 */
function ensureCsvHeader(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, 'book,chapter,paragraph,title,startVerseNo,endVerseNo\n', 'utf-8');
  }
}

function appendRecordsToCSV(filePath: string, records: ParagraphRecord[]): void {
  const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = records.map(
    (r) => `${r.book},${r.chapter},${r.paragraph},${escape(r.title)},${r.startVerseNo},${r.endVerseNo}`
  );
  fs.appendFileSync(filePath, rows.join('\n') + '\n', 'utf-8');
}

async function main() {
  const booksCsv = loadBooksCsv();
  const bibleNiv = loadBibleNiv();
  const outputDir = path.join(__dirname, '..', 'data', 'biblePara', 'niv');

  if (bibleNiv.books.length !== booksCsv.length) {
    console.warn(
      `书籍数量不一致: bible-niv.json ${bibleNiv.books.length} 本, books.csv ${booksCsv.length} 行`
    );
  }

  console.log(`开始批量爬取 NIV 段落，共 ${bibleNiv.books.length} 本书`);

  let totalChapters = 0;
  let totalRecords = 0;
  const errors: Array<{ book: string; chapter: number; error: string }> = [];

  for (let i = 0; i < bibleNiv.books.length; i++) {
    const bookNiv = bibleNiv.books[i];
    const bookCsv = booksCsv[i];
    const english = bookCsv ? bookCsv.english : bookNiv.id;
    const csvPath = path.join(outputDir, `${english}.csv`);

    console.log(`\n${english} (${bookNiv.chapters.length} 章)`);
    ensureCsvHeader(csvPath);

    let firstChapter = true;
    for (const ch of bookNiv.chapters) {
      totalChapters++;
      const url = buildNivUrl(english, ch.id);
      console.log('url:',url);
      try {
        const records = await crawlPassage(url, english);
        if (records.length > 0) {
          appendRecordsToCSV(csvPath, records);
          totalRecords += records.length;
          if (firstChapter) firstChapter = false;
          console.log(`  第 ${ch.id} 章 ✓ ${records.length} 条`);
        } else {
          console.log(`  第 ${ch.id} 章 ⚠ 无记录`);
        }
        await randomDelay(1, 3);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  第 ${ch.id} 章 ✗ ${msg}`);
        errors.push({ book: english, chapter: ch.id, error: msg });
        await randomDelay(2, 4);
      }
    }
  }

  console.log(`\n完成: ${totalChapters} 章, ${totalRecords} 条记录, ${errors.length} 个错误`);
  if (errors.length > 0) {
    const errPath = path.join(outputDir, 'errors.json');
    fs.writeFileSync(errPath, JSON.stringify(errors, null, 2), 'utf-8');
    console.log(`错误已写入 ${errPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
