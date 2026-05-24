'use client';

import Link from 'next/link';
import ChapterList from '@/components/ChapterList';
import type { Book } from '@/types/bible';
import { usePreferMobileReaderLayout } from '@/lib/usePreferMobileReaderLayout';

const DEFAULT_VERSION = 'cuvs';

interface BookLandingProps {
  book: Book;
}

/**
 * 书卷章节入口（客户端）：根据视口宽度把「全本阅读」与章节格链接到 /book/mobile/whole/... 或桌面路径。
 */
export default function BookLanding({ book }: BookLandingProps) {
  const preferMobileWhole = usePreferMobileReaderLayout();
  const firstCh = book.chapters[0]?.id ?? 1;

  const wholeBase = preferMobileWhole ? '/book/mobile/whole' : '/book/whole';
  const wholeHref = `${wholeBase}/${book.id}/${firstCh}/${DEFAULT_VERSION}`;

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
        href={wholeHref}
        className="inline-block mb-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        全本阅读
      </Link>
      <ChapterList
        book={book}
        version={DEFAULT_VERSION}
        preferMobileWhole={preferMobileWhole}
      />
    </div>
  );
}
