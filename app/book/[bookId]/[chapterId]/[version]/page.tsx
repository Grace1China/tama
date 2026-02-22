import { getBook, getBible, type BibleVersion } from '@/lib/bible-data';
import ChapterReader from '@/components/ChapterReader';
import { notFound } from 'next/navigation';

const VALID_VERSIONS: BibleVersion[] = ['cuvs', 'cuvt', 'niv'];

function parseVersion(v: string | undefined): BibleVersion | null {
  if (v && VALID_VERSIONS.includes(v as BibleVersion)) return v as BibleVersion;
  return null;
}

export async function generateStaticParams() {
  const params: { bookId: string; chapterId: string; version: string }[] = [];
  for (const version of VALID_VERSIONS) {
    const bible = await getBible(version);
    for (const book of bible.books) {
      for (const chapter of book.chapters) {
        params.push({
          bookId: book.id,
          chapterId: chapter.id.toString(),
          version,
        });
      }
    }
  }
  return params;
}

export default async function ChapterPage({
  params,
}: {
  params: { bookId: string; chapterId: string; version: string };
}) {
  const version = parseVersion(params.version);
  if (!version) {
    notFound();
  }

  const [bible, book] = await Promise.all([getBible(version), getBook(params.bookId, version)]);
  const chapterId = parseInt(params.chapterId, 10);

  if (!book) {
    notFound();
  }

  const chapter = book.chapters.find((ch) => ch.id === chapterId);

  if (!chapter) {
    notFound();
  }

  return (
    <ChapterReader book={book} allBooks={bible.books} startChapterId={chapterId} version={version} />
  );
}
