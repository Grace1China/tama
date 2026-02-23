/**
 * Parse EnglishNIVBible.xml and output data/bible-niv.json
 * with the same structure as data/bible-cuv.json.
 * Book id/title use english from data/books.csv (by book number = order).
 */
import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import * as path from 'path';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
});

interface Verse {
  id: number;
  text: string;
}
interface Chapter {
  id: number;
  verses: Verse[];
}
interface Book {
  id: string;
  title: string;
  chapters: Chapter[];
}
interface Bible {
  version: string;
  books: Book[];
}

function loadBooksCsv(csvPath: string): string[] {
  const csv = fs.readFileSync(csvPath, 'utf-8');
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());
  const orderIdx = headers.indexOf('order');
  const englishIdx = headers.indexOf('english');
  if (orderIdx === -1 || englishIdx === -1) throw new Error('books.csv must have order and english columns');
  const orderToEnglish: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    const order = parseInt(row[orderIdx], 10);
    const english = row[englishIdx]?.trim() ?? '';
    orderToEnglish[order] = english;
  }
  return orderToEnglish;
}

function normalize<T>(x: T | T[]): T[] {
  return Array.isArray(x) ? x : x ? [x] : [];
}

function parseNivXml(xmlPath: string, orderToEnglish: string[]): Bible {
  const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
  const json = parser.parse(xmlContent);
  const bibleEl = json.bible;
  if (!bibleEl) throw new Error('Expected <bible> root');

  const testaments = normalize(bibleEl.testament);
  const allBooks: { number: number; chapters: Chapter[] }[] = [];

  for (const testament of testaments) {
    const bookEls = normalize(testament.book);
    for (const bookEl of bookEls) {
      const num = bookEl['@_number'];
      if (num == null) continue;
      const bookNumber = typeof num === 'number' ? num : parseInt(String(num), 10);
      const chapterEls = normalize(bookEl.chapter);
      const chapters: Chapter[] = [];

      for (const chEl of chapterEls) {
        const chNum = chEl['@_number'];
        const chapterId = typeof chNum === 'number' ? chNum : parseInt(String(chNum), 10);
        const verseEls = normalize(chEl.verse);
        const verses: Verse[] = verseEls
          .map((v: any) => {
            const vNum = v['@_number'];
            const id = typeof vNum === 'number' ? vNum : parseInt(String(vNum), 10);
            const text = (v['#text'] ?? v ?? '').trim();
            return text ? { id, text } : null;
          })
          .filter((v): v is Verse => v != null && v.text !== '');

        if (verses.length) chapters.push({ id: chapterId, verses });
      }

      allBooks.push({ number: bookNumber, chapters });
    }
  }

  allBooks.sort((a, b) => a.number - b.number);

  const books: Book[] = allBooks.map(({ number, chapters }) => {
    const english = orderToEnglish[number];
    if (!english) throw new Error(`No english for book number ${number} in books.csv`);
    return {
      id: english,
      title: english,
      chapters,
    };
  });

  return {
    version: 'NIV',
    books,
  };
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const booksCsvPath = path.join(projectRoot, 'data', 'books.csv');
  const nivXmlPath = path.join(projectRoot, 'EnglishNIVBible.xml');
  const outPath = path.join(projectRoot, 'data', 'bible-niv.json');

  if (!fs.existsSync(booksCsvPath)) throw new Error('data/books.csv not found');
  if (!fs.existsSync(nivXmlPath)) throw new Error('EnglishNIVBible.xml not found');

  const orderToEnglish = loadBooksCsv(booksCsvPath);
  const bible = parseNivXml(nivXmlPath, orderToEnglish);

  fs.writeFileSync(outPath, JSON.stringify(bible, null, 2), 'utf-8');
  console.log(`Written ${bible.books.length} books to ${outPath}`);
}

main();
