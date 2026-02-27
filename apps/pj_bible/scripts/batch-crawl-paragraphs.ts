/**
 * 批量爬取所有书籍的段落信息
 * 从 bible.json 读取所有书籍，遍历每本书的所有章节，爬取段落信息并保存到 data/biblePara/
 *
 * 用法: npm run batch-crawl-paragraphs
 * 或:   tsx scripts/batch-crawl-paragraphs.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { crawlPassage, ParagraphRecord } from './crawl-biblegateway';

interface Book {
  id: string;
  title: string;
  fullname: string;
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
function buildUrl(bookTitle: string, chapter: number, version: string = 'niv'): string {
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
export function loadBible(): Bible {
  const filePath = path.join(__dirname, '..', 'data', 'bible-niv.json');
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * 保存记录到 CSV 文件（追加模式）
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
  const bible = loadBible();
  const outputDir = path.join(__dirname, '..', 'data', 'biblePara','niv');

  console.log(`开始批量爬取，共 ${bible.books.length} 本书`);

  let totalBooks = 0;
  let totalChapters = 0;
  let totalRecords = 0;
  let errors: Array<{ book: string; chapter: number; error: string }> = [];

  const header = 'book,chapter,paragraph,title,startVerseNo,endVerseNo';

  for (const book of bible.books.filter(book => book.id == 'REV')) {///filter(book => book.id == 'Zephaniah' || book.id == 'Nahum')
    console.log(`\n处理: ${book.title} (${book.id}) - ${book.chapters.length} 章`);
    totalBooks++;

    // 下载该书章节内容之前先清空 {book.id}.csv（只保留表头）
    const bookCsvPath = path.join(outputDir, `${book.id.toLowerCase()}.csv`);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(bookCsvPath, header + '\n', 'utf-8');

    for (const chapter of book.chapters) {
      totalChapters++;
      const url = buildUrl(book.fullname||book.id, chapter.id);
     
      try {
        console.log(`  爬取第 ${chapter.id} 章...`);
        console.log('url:',url);
        // https://www.biblegateway.com/passage/?search=%E5%88%9B%E4%B8%96%E8%AE%B0%201&version=CCB&interface=print
        
        const records = await crawlPassage(url, book.id);
        
        if (records.length > 0) {
          const outputFile = path.join(outputDir, `${book.id.toLowerCase()}.csv`);
          appendRecordsToCSV(outputFile, records);
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
// const bible = loadBible();
// let bookMap = bible.books.map(book => ({ [book.id]: book.title as string }));
// console.log(bookMap);