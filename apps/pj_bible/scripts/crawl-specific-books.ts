/**
 * 爬取指定书籍的段落信息
 * 可以指定书籍标题列表，重新爬取这些书籍
 *
 * 用法: npm run crawl-specific-books -- "雅歌,約珥書,馬可福音,約翰福音"
 * 或:   tsx scripts/crawl-specific-books.ts "雅歌,約珥書,馬可福音,約翰福音"
 */

import * as fs from 'fs';
import * as path from 'path';
import { crawlPassage, ParagraphRecord } from './crawl-biblegateway';

interface Book {
  id: string;
  title: string;
  chapters: Array<{ id: number }>;
}

interface Bible {
  books: Book[];
}

/**
 * 将中文书名转换为 URL 编码格式
 */
function encodeBookTitle(title: string): string {
  return encodeURIComponent(title);
}

/**
 * 构建 Bible Gateway URL
 */
function buildUrl(bookTitle: string, chapter: number, version: string = 'CCB'): string {
  const encodedTitle = encodeBookTitle(`${bookTitle} ${chapter}`);
  return `https://www.biblegateway.com/passage/?search=${encodedTitle}&version=${version}&interface=print`;
}

/**
 * 随机延迟（防止反爬虫）
 */
function randomDelay(minSeconds: number = 1, maxSeconds: number = 3): Promise<void> {
  const delayMs = Math.floor(Math.random() * (maxSeconds - minSeconds + 1) * 1000) + minSeconds * 1000;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * 读取 bible.json
 */
function loadBible(): Bible {
  const filePath = path.join(__dirname, '..', 'data', 'bible.json');
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * 保存记录到 CSV 文件（覆盖模式，重新爬取时使用）
 */
function writeRecordsToCSV(filePath: string, records: ParagraphRecord[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const header = 'book,chapter,paragraph,title,startVerseNo,endVerseNo';
  const rows = records.map((r) => {
    return `${r.book},${r.chapter},${r.paragraph},"${r.title}",${r.startVerseNo},${r.endVerseNo}`;
  });

  const csvContent = [header, ...rows].join('\n') + '\n';
  fs.writeFileSync(filePath, csvContent, 'utf-8');
}

/**
 * 追加记录到 CSV 文件
 */
function appendRecordsToCSV(filePath: string, records: ParagraphRecord[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const header = 'book,chapter,paragraph,title,startVerseNo,endVerseNo';
  const rows = records.map((r) => {
    return `${r.book},${r.chapter},${r.paragraph},"${r.title}",${r.startVerseNo},${r.endVerseNo}`;
  });

  const csvContent = rows.join('\n') + '\n';

  // 如果文件不存在，先写入 header
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, header + '\n', 'utf-8');
  }

  // 追加记录
  fs.appendFileSync(filePath, csvContent, 'utf-8');
}

async function main() {
  const bookTitlesArg = process.argv[2];
  if (!bookTitlesArg) {
    console.error('请指定要爬取的书籍标题，用逗号分隔');
    console.error('例如: npm run crawl-specific-books -- "雅歌,約珥書,馬可福音,約翰福音"');
    process.exit(1);
  }

  const targetTitles = bookTitlesArg.split(',').map((t) => t.trim());
  const bible = loadBible();
  const outputDir = path.join(__dirname, '..', 'data', 'biblePara');

  console.log(`开始爬取指定书籍: ${targetTitles.join(', ')}`);

  // 找到要爬取的书籍
  const targetBooks = bible.books.filter((book) => targetTitles.includes(book.title));

  if (targetBooks.length === 0) {
    console.error('未找到指定的书籍');
    console.error('可用的书籍:', bible.books.map((b) => b.title).join(', '));
    process.exit(1);
  }

  if (targetBooks.length !== targetTitles.length) {
    const foundTitles = targetBooks.map((b) => b.title);
    const notFound = targetTitles.filter((t) => !foundTitles.includes(t));
    console.warn(`警告: 以下书籍未找到: ${notFound.join(', ')}`);
  }

  let totalBooks = 0;
  let totalChapters = 0;
  let totalRecords = 0;
  let errors: Array<{ book: string; chapter: number; error: string }> = [];

  for (const book of targetBooks) {
    console.log(`\n处理: ${book.title} (${book.id}) - ${book.chapters.length} 章`);
    totalBooks++;

    const outputFile = path.join(outputDir, `${book.id.toLowerCase()}.csv`);
    let isFirstChapter = true;

    for (const chapter of book.chapters) {
      totalChapters++;
      const url = buildUrl(book.title, chapter.id);

      try {
        console.log(`  爬取第 ${chapter.id} 章...`);
        const records = await crawlPassage(url, book.id);

        if (records.length > 0) {
          if (isFirstChapter) {
            // 第一个章节时，覆盖文件（重新爬取）
            writeRecordsToCSV(outputFile, records);
            isFirstChapter = false;
          } else {
            // 后续章节追加
            appendRecordsToCSV(outputFile, records);
          }
          totalRecords += records.length;
          console.log(`    ✓ 成功，获得 ${records.length} 条记录`);
        } else {
          console.log(`    ⚠ 警告：没有解析到记录`);
        }

        // 随机延迟（1-3秒）
        await randomDelay(1, 3);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`    ✗ 错误: ${errorMsg}`);
        errors.push({ book: book.title, chapter: chapter.id, error: errorMsg });

        // 出错后也延迟一下
        await randomDelay(2, 4);
      }
    }
  }

  console.log(`\n完成！`);
  console.log(`  处理了 ${totalBooks} 本书，${totalChapters} 章`);
  console.log(`  共获得 ${totalRecords} 条记录`);
  console.log(`  错误: ${errors.length} 个`);

  if (errors.length > 0) {
    console.log(`\n错误详情:`);
    errors.forEach((e) => {
      console.log(`  ${e.book} 第 ${e.chapter} 章: ${e.error}`);
    });

    // 保存错误日志
    const errorLogPath = path.join(outputDir, 'errors.json');
    fs.writeFileSync(errorLogPath, JSON.stringify(errors, null, 2), 'utf-8');
    console.log(`\n错误日志已保存到: ${errorLogPath}`);
  }
}

main().catch((err) => {
  console.error('致命错误:', err);
  process.exit(1);
});
