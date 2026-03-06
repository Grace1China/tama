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

/**
 * 保存记录并按章节、段落排序
 * 如果记录已存在，则会被新记录覆盖（通过 filter 掉旧章节实现）
 */
function saveAndSortCSV(filePath: string, newRecords: ParagraphRecord[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const header = 'book,chapter,paragraph,title,startVerseNo,endVerseNo';
  let allRecords: ParagraphRecord[] = [...newRecords];

  // 1. 如果文件已存在，读取现有数据进行合并
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(1); // 跳过表头

    const existingRecords: ParagraphRecord[] = lines
      .filter(line => line.trim() !== '')
      .map(line => {
        // 简单的 CSV 解析（处理带引号的标题）
        const match = line.match(/([^,]+),([^,]+),([^,]+),"(.*)",([^,]+),([^,]+)/);
        if (!match) return null;
        return {
          book: match[1],
          chapter: parseInt(match[2]),
          paragraph: parseInt(match[3]),
          title: match[4],
          startVerseNo: parseInt(match[5]),
          endVerseNo: parseInt(match[6])
        };
      })
      .filter((r): r is ParagraphRecord => r !== null);

    // 2. 排除掉当前正在爬取的章节（防止重复，实现“替换”效果）
    const newChapters = new Set(newRecords.map(r => r.chapter));
    const filteredExisting = existingRecords.filter(r => !newChapters.has(r.chapter));
    
    allRecords = [...filteredExisting, ...newRecords];
  }

  // 3. 排序逻辑：先按章节(chapter)升序，再按段落(paragraph)升序
  allRecords.sort((a, b) => {
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.paragraph - b.paragraph;
  });

  // 4. 转换为 CSV 字符串并写入
  const rows = allRecords.map(r => 
    `${r.book},${r.chapter},${r.paragraph},"${r.title}",${r.startVerseNo},${r.endVerseNo}`
  );
  fs.writeFileSync(filePath, [header, ...rows].join('\n') + '\n', 'utf-8');
}

async function main1() {
  const bible = loadBible();
  const outputDir = path.join(__dirname, '..', 'data', 'biblePara','niv');

  console.log(`开始批量爬取，共 ${bible.books.length} 本书`);

  let totalBooks = 0;
  let totalChapters = 0;
  let totalRecords = 0;
  let errors: Array<{ book: string; chapter: number; error: string }> = [];

  const header = 'book,chapter,paragraph,title,startVerseNo,endVerseNo';

  for (const book of bible.books.filter(book => book.id == 'PSA')) {///filter(book => book.id == 'Zephaniah' || book.id == 'Nahum')
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

async function main() {
  const bible = loadBible();
  const outputDir = path.join(__dirname, '..', 'data', 'biblePara', 'niv');

  // 获取命令行参数
  const argBookId = process.argv[3];    // 书本 ID (如: PSA)
  const argChapterId = process.argv[4]; // 章节 ID (如: 1)
  console.log('argBookId:',argBookId);

  // 过滤书籍
  let booksToProcess = bible.books;
  if (argBookId) {
    booksToProcess = bible.books.filter(b => b.id.toLowerCase() === argBookId.toLowerCase());
  } else {
    // 默认示例：只处理诗篇，你可以根据需要改为全选
    booksToProcess = bible.books.filter(book => book.id === 'PSA');
  }
  console.log('booksToProcess:',booksToProcess);

  for (const book of booksToProcess) {
    console.log(`\n处理: ${book.title} (${book.id})`);
    const bookCsvPath = path.join(outputDir, `${book.id.toLowerCase()}.csv`);

    // 确定章节
    let chaptersToProcess = book.chapters;
    if (argChapterId) {
      const target = parseInt(argChapterId, 10);
      chaptersToProcess = book.chapters.filter(c => c.id === target);
    }

    for (const chapter of chaptersToProcess) {
      const url = buildUrl(book.fullname || book.id, chapter.id);
     
      try {
        console.log(`  正在爬取第 ${chapter.id} 章...`);
        const records = await crawlPassage(url, book.id);
        
        if (records.length > 0) {
          // 调用排序保存函数
          saveAndSortCSV(bookCsvPath, records);
          console.log(`    ✓ 成功并排序：${records.length} 条记录`);
        }
        await randomDelay(1, 2);
      } catch (err) {
        console.error(`    ✗ 错误: ${err}`);
      }
    }
  }
  console.log('\n任务结束');
}

main().catch((err) => {
  console.error('致命错误:', err);
  process.exit(1);
});
// const bible = loadBible();
// let bookMap = bible.books.map(book => ({ [book.id]: book.title as string }));
// console.log(bookMap);