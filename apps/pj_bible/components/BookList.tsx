import Link from 'next/link';
import { Book } from '@/types/bible';

interface BookListProps {
  books: Book[];
}

export default function BookList({ books }: BookListProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {books.map((book) => (
        <Link
          key={book.id}
          href={`/book/${book.id}`}
          className="block p-4 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border border-gray-200 hover:border-blue-300"
        >
          <div className="font-semibold text-lg text-gray-900 mb-1">
            {book.title}
          </div>
          <div className="text-sm text-gray-500">
            {book.id} · {book.chapters.length} 章
          </div>
        </Link>
      ))}
    </div>
  );
}
