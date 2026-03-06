/**
 * 爬取 Bible Gateway 经文页，解析 URL 中的章节，并分析页面中的分段（小标题 + 段落）。
 * 输出 CSV 格式，每条记录包含：book, chapter, paragraph, title, startVerseNo, endVerseNo
 *
 * 用法: npm run crawl-passage -- "https://www.biblegateway.com/passage/?search=箴言%202&version=CCB&interface=print"
 * 或:   tsx scripts/crawl-biblegateway.ts "https://..."
 */

import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_URL =
  'https://www.biblegateway.com/passage/?search=%E7%AE%B4%20%E8%A8%80%202&version=CCB&interface=print';

export interface ParagraphRecord {
  book: string;
  chapter: number;
  paragraph: number;
  title: string;
  startVerseNo: number;
  endVerseNo: number;
}

/**
 * 从 URL 解析出 search 参数（书名+章节）和 version。
 * 例如: search=箴言%202&version=CCB => book=箴言, chapter=2, version=CCB
 * 返回的 book 需要转换为小写英文（如 romans, isa）
 */
function parseUrl(url: string): { book: string; chapter: number; version: string } {
  const u = new URL(url);
  const search = u.searchParams.get('search') || '';
  const version = u.searchParams.get('version') || '';

  const decoded = decodeURIComponent(search).trim();
  const lastSpace = decoded.lastIndexOf(' ');
  const bookName = lastSpace >= 0 ? decoded.slice(0, lastSpace).trim() : decoded;
  const chapterStr = lastSpace >= 0 ? decoded.slice(lastSpace + 1).trim() : '1';
  const chapter = parseInt(chapterStr, 10) || 1;

  // 将中文书名转换为英文小写（简化版，可以扩展映射表）
  const bookMap: Record<string, string> = {
    罗马书: 'romans',
    箴言: 'proverbs',
    以赛亚书: 'isa',
    创世纪: 'genesis',
    // 可以继续添加更多映射
  };
  const book = bookMap[bookName] || bookName.toLowerCase().replace(/\s+/g, '');

  return { book, chapter, version };
}

/**
 * 从 span.text 类名中解析节号
 * 例如: "Isa-4-1" => { book: "isa", chapter: 4, verse: 1 }
 */
function parseVerseId(classAttr: string): { book: string; chapter: number; verse: number } | null {
  const match = classAttr.match(/(\w+)-(\d+)-(\d+)/);
  if (!match) return null;
  return {
    book: match[1].toLowerCase(),
    chapter: parseInt(match[2], 10),
    verse: parseInt(match[3], 10),
  };
}

/**
 * 抓取页面 HTML 并解析出章节与分段，输出 CSV 格式记录。
 * @param url Bible Gateway URL
 * @param bookId 可选的 book ID（如 "ROM", "GEN"），如果提供则覆盖从 URL 解析出的 book
 */
export async function crawlPassage(url: string, bookId?: string): Promise<ParagraphRecord[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const { book: parsedBook, chapter, version } = parseUrl(url);
  const book = bookId ? bookId.toLowerCase() : parsedBook;

  // 找到 .passage-content 下的 .text-html
  const $textHtml = $('.text-html .std-text').first();
  if (!$textHtml.length) {
    throw new Error('找不到 .text-html 元素');
  }

  const records: ParagraphRecord[] = [];
  let currentTitle: string = '(无小标题)';
  let paragraphIndex = 0;
  let currentParagraphVerses: number[] = [];

  const processParagraph = () => {
    if (currentParagraphVerses.length > 0) {
      paragraphIndex++;
      const startVerseNo = Math.min(...currentParagraphVerses);
      const endVerseNo = Math.max(...currentParagraphVerses);
      records.push({
        book,
        chapter,
        paragraph: paragraphIndex,
        title: currentTitle,
        startVerseNo,
        endVerseNo,
      });
      currentParagraphVerses = [];
    }
  };

  // 遍历 .text-html 下所有相关元素（按文档顺序）：
  // - h3 / h4：小标题
  // - p：段落
  // - div.poetry / div.list：诗歌或列表段落
  $textHtml.find('h3, h4, p, div.poetry, div.list').each((_, el) => {
    const $el = $(el);
    const tag = el.tagName?.toLowerCase();

    // h3 / h4 是小标题（可能同时出现作为一段标题）
    if (tag === 'h3' || tag === 'h4') {
      processParagraph();
      currentTitle = $el.text().trim() || '(无小标题)';
      return;
    }

    // p 标签或 div.poetry / div.list 是段落
    if (tag === 'p' || (tag === 'div' && ($el.hasClass('poetry') || $el.hasClass('list')))) {
      // 先处理之前的段落
      processParagraph();

      // 在当前段落中查找所有 span.text 元素，提取节号
      // span.text 的 class 属性可能包含类似 "text Isa-4-1" 或 "Isa-4-1" 的格式
      $el.find('span.text, span[class*="-"]').each((_, span) => {
        const $span = $(span);
        const spanClass = $span.attr('class') || '';
        
        // 尝试从 class 中提取节号（格式：Book-Chapter-Verse）
        const verseInfo = parseVerseId(spanClass);
        if (verseInfo && verseInfo.chapter === chapter) {
          currentParagraphVerses.push(verseInfo.verse);
        }
      });

      // 如果没有找到 span.text，尝试从文本中提取节号（备用方案）
      // 经文通常以数字开头，如 "2 孩子啊，"
      if (currentParagraphVerses.length === 0) {
        const text = $el.text().trim();
        // 匹配段落开头的节号，如 "2 孩子啊，" 或 "16 智慧要救你"
        const verseMatch = text.match(/^(\d+)\s/);
        if (verseMatch) {
          const verseNum = parseInt(verseMatch[1], 10);
          if (!isNaN(verseNum) && verseNum > 0 && verseNum < 200) {
            currentParagraphVerses.push(verseNum);
          }
        }
      }
    }
  });

  // 处理最后一个段落
  processParagraph();

  return records;
}

/**
 * 将记录数组转换为 CSV 格式字符串
 */
function recordsToCSV(records: ParagraphRecord[]): string {
  const header = 'book,chapter,paragraph,title,startVerseNo,endVerseNo';
  const rows = records.map((r) => {
    return `${r.book},${r.chapter},${r.paragraph},"${r.title}",${r.startVerseNo},${r.endVerseNo}`;
  });
  return [header, ...rows].join('\n');
}

async function main() {
  const url = process.argv[2] || DEFAULT_URL;
  const outputPath = process.argv[3]; // 可选的输出文件路径

  console.log('Fetching:', url);
  const records = await crawlPassage(url);

  if (records.length === 0) {
    console.warn('警告: 没有解析到任何记录');
    return;
  }

  const csv = recordsToCSV(records);

  if (outputPath) {
    const fullPath = path.resolve(outputPath);
    fs.writeFileSync(fullPath, csv, 'utf-8');
    console.log(`已保存到: ${fullPath}`);
    console.log(`共 ${records.length} 条记录`);
  } else {
    // 输出到控制台
    console.log(csv);
  }
}

// main().catch((err) => {
//   console.error(err);
//   process.exit(1);
// });
