import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { ParagraphInfo } from '@/types/paragraph';

const BOOK_TO_CSV: Record<string, string> = {
  ROM: 'romans.csv',
};

export async function GET(request: NextRequest) {
  
  const bookId = request.nextUrl.searchParams.get('bookId');
  let version = request.nextUrl.searchParams.get('version');
  if (!bookId) {
    return NextResponse.json(
      { error: 'Missing bookId query parameter' },
      { status: 400 }
    );
  }

  const csvFile = `${bookId}.csv`//BOOK_TO_CSV[bookId];
  if (!csvFile) {
    return NextResponse.json([]);
  }

  // Ensure version and csvFile are both strings before proceeding
  if (!version || !csvFile) {
    return NextResponse.json([]);
  }

  if (version == 'cuvs' || version == 'cuvt' ) {
    version = 'cuv';
  }
  const filePath = path.join(process.cwd(), 'data/biblePara', version, csvFile);
  console.log('filePath:',filePath);
  const sqlPath = filePath.replace(/\\/g, '/').replace(/'/g, "''");

  try {
    const duckdb = await import('duckdb');
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();

    const rows = await new Promise<ParagraphInfo[]>((resolve, reject) => {
      conn.all(
        `SELECT book, chapter, paragraph, title, "startVerseNo", "endVerseNo" FROM read_csv_auto('${sqlPath}') ORDER BY chapter, paragraph`,
        (err: Error | null, result: unknown) => {
          db.close();
          if (err) {
            reject(err);
            return;
          }
          const rows = (result as Record<string, unknown>[]).map((row) => {
            const getNum = (key: string) =>
              Number(row[key] ?? row[key.toLowerCase()] ?? 0);
            const getStr = (key: string) =>
              String(row[key] ?? row[key.toLowerCase()] ?? '');
            return {
              book: getStr('book'),
              chapter: getNum('chapter'),
              paragraph: getNum('paragraph'),
              title: getStr('title'),
              startVerseNo: getNum('startVerseNo'),
              endVerseNo: getNum('endVerseNo'),
            };
          });
          resolve(rows);
        }
      );
    });

    return NextResponse.json(rows);
  } catch (err) {
    console.error('Paragraph API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read paragraph data' },
      { status: 500 }
    );
  }
}
