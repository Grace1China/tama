import Link from 'next/link';
import { Book } from '@/types/bible';

const DEFAULT_VERSION = 'cuvs';

interface ChapterListProps {
  book: Book;
  /** 版本，用于生成章节链接路径，默认 cuvs */
  version?: string;
  /** 窄屏书卷页为 true：章节格跳转移动端全本阅读（从该章起连续），与桌面单章 /book/id/ch/version 区分 */
  preferMobileWhole?: boolean;
}

export default function ChapterList({
  book,
  version = DEFAULT_VERSION,
  preferMobileWhole = false,
}: ChapterListProps) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">章節</h2>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
        {book.chapters.map((chapter) => (
          <Link
            key={chapter.id}
            href={
              preferMobileWhole
                ? `/book/mobile/whole/${book.id}/${chapter.id}/${version}`
                : `/book/${book.id}/${chapter.id}/${version}`
            }
            className="block p-3 text-center bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow border border-gray-200 hover:border-blue-400 hover:bg-blue-50"
          >
            <span className="text-lg font-medium text-gray-900">
              {chapter.id}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
