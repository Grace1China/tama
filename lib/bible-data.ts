import { Bible, Book } from '@/types/bible';
import fs from 'fs';
import path from 'path';

export type BibleVersion = 'cuvs' | 'cuvt' | 'niv';

const VERSION_FILES: Record<BibleVersion, string> = {
  cuvs: 'bible-cuv-simple.json',
  cuvt: 'bible-cuv.json',
  niv: 'bible-niv.json',
};

const bibleCache: Partial<Record<BibleVersion, Bible>> = {};

export async function getBible(version: BibleVersion = 'cuvs'): Promise<Bible> {
  if (bibleCache[version]) {
    return bibleCache[version]!;
  }

  const fileName = VERSION_FILES[version];
  const filePath = path.join(process.cwd(), 'data', fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Bible data not found for version ${version}. Expected ${fileName} in data/`
    );
  }

  const fileContents = fs.readFileSync(filePath, 'utf8');
  const bible = JSON.parse(fileContents) as Bible;
  bibleCache[version] = bible;
  return bible;
}

export async function getBook(bookId: string, version: BibleVersion = 'cuvs'): Promise<Book | null> {
  const bible = await getBible(version);
  return bible.books.find((book) => book.id === bookId) || null;
}
