import { ParagraphInfo } from '@/types/paragraph';
import fs from 'fs';
import path from 'path';

const BOOK_TO_CSV: Record<string, string> = {
  ROM: 'romans.csv',
};

export function getParagraphInfo(bookId: string): ParagraphInfo[] | null {
  const csvFile = BOOK_TO_CSV[bookId];
  if (!csvFile) return null;

  const filePath = path.join(process.cwd(), 'data', csvFile);
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) return null;

  const headers = lines[0].split(',');
  const rows: ParagraphInfo[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h.trim()] = values[j] ?? '';
    });
    rows.push({
      book: row.book ?? '',
      chapter: parseInt(row.chapter ?? '0', 10),
      paragraph: parseInt(row.paragraph ?? '0', 10),
      title: row.title ?? '',
      startVerseNo: parseInt(row.startVerseNo ?? '0', 10),
      endVerseNo: parseInt(row.endVerseNo ?? '0', 10),
    });
  }

  return rows;
}
