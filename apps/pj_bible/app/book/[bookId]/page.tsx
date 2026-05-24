import { getBook } from '@/lib/bible-data';
import BookLanding from '@/components/BookLanding';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function BookPage({
  params,
}: {
  params: { bookId: string };
}) {
  const book = await getBook(params.bookId);

  if (!book) {
    notFound();
  }

  return <BookLanding book={book} />;
}
