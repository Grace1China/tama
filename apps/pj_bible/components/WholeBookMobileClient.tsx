'use client';

import { useEffect, useState } from 'react';
import ChapterReader from './ChapterReader';
import type { Bible, Book } from '@/types/bible';
import type { BibleVersion } from '@/lib/bible-data';

interface WholeBookMobileClientProps {
  bookId: string;
  startChapterId: number;
  version: BibleVersion;
}

/** 移动端阅读路由专用：单列纵向滚动，不靠 CSS columns 横滑分页。数据加载逻辑与 WholeBookClient 一致 */
export default function WholeBookMobileClient({
  bookId,
  startChapterId,
  version,
}: WholeBookMobileClientProps) {
  const [bible, setBible] = useState<Bible | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const storageBibleKey = `bible:${version}`;
    const storageBookKey = `bible-book:${version}:${bookId}`;

    const load = async () => {
      setLoading(true);
      setError(null);

      let cachedBibleMeta: Bible | null = null;
      let cachedBook: Book | null = null;
      try {
        if (typeof window !== 'undefined') {
          const rawBible = localStorage.getItem(storageBibleKey);
          if (rawBible) {
            const parsed = JSON.parse(rawBible) as { bible?: Bible; books?: Bible['books'] };
            if (parsed.bible) {
              cachedBibleMeta = parsed.bible;
            } else if (parsed.books) {
              cachedBibleMeta = { books: parsed.books } as Bible;
            }
          }
          const rawBook = localStorage.getItem(storageBookKey);
          if (rawBook) {
            const parsedBook = JSON.parse(rawBook) as { book?: Book };
            if (parsedBook.book) cachedBook = parsedBook.book;
          }
        }
      } catch {
        // ignore parse errors
      }

      if (cancelled) return;

      if (cachedBibleMeta && cachedBook) {
        setBible(cachedBibleMeta);
        setBook(cachedBook);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/bible?version=${encodeURIComponent(version)}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { bible: Bible };
        if (cancelled) return;
        const nextBible = data.bible;
        setBible(nextBible);
        const b = nextBible.books.find((bk) => bk.id === bookId) || null;
        setBook(b);

        try {
          const lightBible: Bible = {
            version: nextBible.version,
            books: nextBible.books.map((bk) => ({
              id: bk.id,
              title: bk.title,
              chapters: bk.chapters.length
                ? [{ id: bk.chapters[0].id, verses: [] }]
                : [],
            })),
          };
          const biblePayload = { bible: lightBible, updatedAt: Date.now() };
          localStorage.setItem(storageBibleKey, JSON.stringify(biblePayload));

          if (b) {
            const bookPayload = { book: b, updatedAt: Date.now() };
            localStorage.setItem(storageBookKey, JSON.stringify(bookPayload));
          }
        } catch {
          // ignore
        }
      } catch (err) {
        if (!cancelled) {
          setError('加载圣经数据失败，请稍后重试。');
          console.error(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [bookId, version]);

  if (loading && !book) {
    return <div className="p-4 text-gray-500 text-sm">正在加载经文…</div>;
  }

  if (error || !book || !bible) {
    return (
      <div className="p-4 text-red-600 text-sm">
        {error ?? '未找到对应的书卷或版本。'}
      </div>
    );
  }

  const chapter = book.chapters.find((ch) => ch.id === startChapterId);
  const effectiveChapterId = chapter ? startChapterId : book.chapters[0]?.id ?? 1;

  return (
    <ChapterReader
      book={book}
      allBooks={bible.books}
      startChapterId={effectiveChapterId}
      wholeBook
      version={version}
      mobileReader
    />
  );
}
