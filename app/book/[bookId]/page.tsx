import { getBible, getBook } from '@/lib/bible-data';
import ChapterList from '@/components/ChapterList';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export async function generateStaticParams() {
  const bible = await getBible();
  return bible.books.map((book) => ({
    bookId: book.id,
  }));
}

export default async function BookPage({
  params,
}: {
  params: { bookId: string };
}) {
  const book = await getBook(params.bookId);

  if (!book) {
    notFound();
  }

  return (
    <div>
      <Link
        href="/"
        className="text-blue-600 hover:text-blue-800 mb-4 inline-block"
      >
        ← 返回書目
      </Link>
      <h1 className="text-3xl font-bold mb-6">{book.title}</h1>
      <p className="text-gray-600 mb-6">共 {book.chapters.length} 章</p>
      <Link
        href={`/book/whole/${book.id}/${book.chapters[0]?.id ?? 1}/cuvs`}
        className="inline-block mb-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        全本阅读
      </Link>
      <ChapterList book={book} />
    </div>
  );
}
