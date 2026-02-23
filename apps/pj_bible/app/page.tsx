import { getBible } from '@/lib/bible-data';
import BookList from '@/components/BookList';

export default async function Home() {
  const bible = await getBible();

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8 text-center">聖經</h1>
      <BookList books={bible.books} />
    </div>
  );
}
