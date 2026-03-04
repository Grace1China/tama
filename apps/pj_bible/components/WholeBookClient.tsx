'use client';

import { useEffect, useState } from 'react';
import ChapterReader from './ChapterReader';
import type { Bible, Book } from '@/types/bible';
import type { BibleVersion } from '@/lib/bible-data';

interface WholeBookClientProps {
  bookId: string;
  startChapterId: number;
  version: BibleVersion;
}

export default function WholeBookClient({
  bookId,
  startChapterId,
  version,
}: WholeBookClientProps) {
  const [bible, setBible] = useState<Bible | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 客户端缓存 + API 拉取：优先使用 localStorage 中的 bible:{version}，缺失时请求 /api/bible
  useEffect(() => {
    let cancelled = false;
    const storageBibleKey = `bible:${version}`;
    const storageBookKey = `bible-book:${version}:${bookId}`;

    const load = async () => {
      setLoading(true);
      setError(null);
      console.log('load 333', `bible:${version}`,version);

      // 1. 尝试从 localStorage 读取
      let cachedBibleMeta: Bible | null = null;
      let cachedBook: Book | null = null;
      try {
        if (typeof window !== 'undefined') {
          const rawBible = localStorage.getItem(storageBibleKey);
          if (rawBible) {
            const parsed = JSON.parse(rawBible) as { bible?: Bible; books?: Bible['books'] };
            // 兼容旧结构：可能只存过 books
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

      // 2. 无缓存时，请求 API
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
          // 为了减小 localStorage 体积，只在版本缓存中存「精简后的 books 元数据」，
          // 具体经文内容按「版本+书卷」单独缓存一份
          const lightBible: Bible = {
            version: nextBible.version,
            books: nextBible.books.map((bk) => ({
              id: bk.id,
              title: bk.title,
              // 仅保留首章 id，verses 置空，减少体积
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
          // localStorage 失败时忽略
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
    />
  );
}

