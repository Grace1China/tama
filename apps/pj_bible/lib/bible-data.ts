import { Bible, Book } from '@/types/bible';
import fs from 'fs';
import path from 'path';

export type BibleVersion = 'cuvs' | 'cuvt' | 'niv';

const VERSION_FILES: Record<BibleVersion, string> = {
  cuvs: 'bible-cuv-simple.json',
  cuvt: 'bible-cuv.json',
  niv: 'bible-niv.json',
};

type BibleCacheEntry = {
  bible: Bible;
  /** 对应 JSON 文件的最后修改时间（毫秒），用于检查是否需要重新加载 */
  mtimeMs: number;
};

const bibleCache: Partial<Record<BibleVersion, BibleCacheEntry>> = {};

export async function getBible(version: BibleVersion = 'cuvs'): Promise<Bible> {
  const fileName = VERSION_FILES[version];
  const filePath = path.join(process.cwd(), 'data', fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Bible data not found for version ${version}. Expected ${fileName} in data/`
    );
  }

  const stat = fs.statSync(filePath);
  const mtimeMs = stat.mtimeMs;
  const cached = bibleCache[version];

  // 如果已有缓存且文件修改时间未变化，直接返回缓存，避免重复读盘
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.bible;
  }

  const fileContents = fs.readFileSync(filePath, 'utf8');
  const bible = JSON.parse(fileContents) as Bible;
  bibleCache[version] = { bible, mtimeMs };
  return bible;
}

export async function getBook(bookId: string, version: BibleVersion = 'cuvs'): Promise<Book | null> {
  const bible = await getBible(version);
  return bible.books.find((book) => book.id === bookId) || null;
}
