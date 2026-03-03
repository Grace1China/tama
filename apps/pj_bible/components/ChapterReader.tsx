'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import VerseDisplay from './VerseDisplay';
import { getBookNameChiSimple } from '@/lib/book-names';
import { Book, Chapter } from '@/types/bible';
import { ParagraphInfo } from '@/types/paragraph';

const VERSION_OPTIONS = [
  { key: 'cuvs' as const, label: 'CUVS' },
  { key: 'cuvt' as const, label: 'CUVT' },
  { key: 'niv' as const, label: 'NIV' },
] as const;

interface ChapterReaderProps {
  book: Book;
  startChapterId: number;
  /** 全本模式：章节不换页，连续流动 */
  wholeBook?: boolean;
  /** 全部书卷列表，用于悬浮显示书卷选择区域 */
  allBooks?: Book[];
  /** 当前版本，用于切换和链接保留 */
  version?: 'cuvs' | 'cuvt' | 'niv';
}

const CLOSE_DELAY_MS = 200;

export default function ChapterReader({ book, startChapterId, wholeBook, allBooks, version = 'cuvs' }: ChapterReaderProps) {
  const [bookMenuOpen, setBookMenuOpen] = useState(false);
  const [chapterMenuOpen, setChapterMenuOpen] = useState(false);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentBookItemRef = useRef<HTMLAnchorElement | null>(null);

  const chapterPath = (b: Book, chId: number, v: string) => `/book/${b.id}/${chId}/${v}`;
  const wholePath = (b: Book, chId: number, v: string) => `/book/whole/${b.id}/${chId}/${v}`;

  const scheduleClose = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setBookMenuOpen(false);
      setChapterMenuOpen(false);
      setVersionMenuOpen(false);
    }, CLOSE_DELAY_MS);
  };

  const cancelClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };
  const startChapter = book.chapters.find((ch) => ch.id === startChapterId);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(
    startChapter ?? null
  );
  const [paragraphInfo, setParagraphInfo] = useState<ParagraphInfo[] | null>(null);
  const [pageInfo, setPageInfo] = useState({ currentPage: 0, totalPages: 1 });
  const [scrollToPageRequest, setScrollToPageRequest] = useState<number | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/paragraphs?bookId=${encodeURIComponent(book.id)}&version=${version}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ParagraphInfo[]) => {
        if (!cancelled) setParagraphInfo(Array.isArray(data) ? data : null);
      })
      .catch(() => {
        if (!cancelled) setParagraphInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    if (!bookMenuOpen) return;
    const el = currentBookItemRef.current;
    if (!el) return;
    const t = requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
    });
    return () => cancelAnimationFrame(t);
  }, [bookMenuOpen]);

  const firstChapterId = (b: Book) => b.chapters[0]?.id ?? 1;

  /** 与 VerseDisplay 一致的 slug，用于右侧目录锚点 */
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'sect';

  /** 右侧目录：只显示小标题，括号内为「章:节」；无 paragraphInfo 时显示「章:1」 */
  const tocSections = ((): { chapterId: number; title: string; isChapterOnly: boolean; startVerseNo?: number }[] => {
    const startIndex = book.chapters.findIndex((ch) => ch.id === startChapterId);
    if (startIndex === -1) return [];
    const chs = book.chapters.slice(startIndex);
    const seen = new Set<number>();
    const chaptersToShow = chs.filter((ch) => {
      if (seen.has(ch.id)) return false;
      seen.add(ch.id);
      return true;
    });
    if (!paragraphInfo || paragraphInfo.length === 0) {
      return chaptersToShow.map((ch) => ({ chapterId: ch.id, title: `${ch.id}:1`, isChapterOnly: true }));
    }
    const out: { chapterId: number; title: string; isChapterOnly: boolean; startVerseNo?: number }[] = [];
    for (const ch of chaptersToShow) {
      const paras = paragraphInfo.filter((p) => p.chapter === ch.id);
      const seenKey = new Set<string>();
      const deduped = paras.filter((p) => {
        const key = `${p.chapter}-${p.paragraph}`;
        if (seenKey.has(key)) return false;
        seenKey.add(key);
        return true;
      });
      for (let i = 0; i < deduped.length; i++) {
        const para = deduped[i];
        const showTitle = i === 0 || deduped[i - 1].title !== para.title;
        const titleToShow = para.title && para.title !== '(无小标题)' ? para.title : null;
        if (showTitle && titleToShow) {
          out.push({ chapterId: ch.id, title: titleToShow, isChapterOnly: false, startVerseNo: para.startVerseNo });
        }
      }
    }
    return out;
  })();

  const scrollToSection = (anchorId: string) => {
    console.log('scrollToSection', anchorId);
    const el = document.getElementById(anchorId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  };

  const handleScrollToPageRequestHandled = () => setScrollToPageRequest(null);
  const handleActiveSectionId = (id: string | null) => {
    console.log('handleActiveSectionId', id);
    setActiveSectionId(id);
  };

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-4rem)] flex flex-col px-2">
      <div className="flex-shrink-0 pt-2 pb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {allBooks ? (
          <>
            <Link
              href={`/book/${book.id}`}
              className="text-blue-600 hover:text-blue-800"
            >
              ← 返回
            </Link>
            <div
              className="relative inline-block ml-1"
              onMouseEnter={() => {
                cancelClose();
                setBookMenuOpen(true);
                setChapterMenuOpen(false);
                setVersionMenuOpen(false);
              }}
              onMouseLeave={scheduleClose}
            >
              <span
                className="text-blue-600 hover:text-blue-800 cursor-default inline-block"
                aria-expanded={bookMenuOpen}
                aria-haspopup="listbox"
              >
                {getBookNameChiSimple(book.id) ?? book.title}
              </span>
              {bookMenuOpen && (
                <div
                  className="absolute left-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-3 max-h-80 overflow-y-auto min-w-[12rem]"
                  role="listbox"
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2px' }}
                >
                  {allBooks.map((b) => (
                    <Link
                      key={b.id}
                      ref={b.id === book.id ? currentBookItemRef : undefined}
                      href={wholeBook ? wholePath(b, firstChapterId(b), version) : chapterPath(b, firstChapterId(b), version)}
                      className={`px-2 py-1.5 text-sm rounded hover:bg-blue-50 text-left ${
                        b.id === book.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                      }`}
                      role="option"
                    >
                      {getBookNameChiSimple(b.id) ?? b.title}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <Link
            href={`/book/${book.id}`}
            className="text-blue-600 hover:text-blue-800 inline-block"
            title={getBookNameChiSimple(book.id) ?? book.title}
          >
            ← 返回 {book.title}
          </Link>
        )}
        <div
          className="relative inline-block"
          onMouseEnter={() => {
            cancelClose();
            setChapterMenuOpen(true);
            setBookMenuOpen(false);
            setVersionMenuOpen(false);
          }}
          onMouseLeave={scheduleClose}
        >
          <button
            type="button"
            className="text-blue-600 hover:text-blue-800 font-medium"
            aria-expanded={chapterMenuOpen}
            aria-haspopup="listbox"
          >
            {currentChapter ? `第 ${currentChapter.id} 章` : ''}
          </button>
          {chapterMenuOpen && (
            <div
              className="absolute left-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-3 max-h-80 overflow-y-auto"
              role="listbox"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '4px' ,paddingTop: '4px',marginTop: '0px'}}
            >
              {book.chapters.map((ch) => (
                <Link
                  key={ch.id}
                  href={wholeBook ? wholePath(book, ch.id, version) : chapterPath(book, ch.id, version)}
                  className={`text-center px-2 py-1.5 text-sm rounded hover:bg-blue-50 ${
                    ch.id === startChapterId ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                  }`}
                  role="option"
                >{ch.id}</Link>
              ))}
            </div>
          )}
        </div>

        <div
          className="relative inline-block"
          onMouseEnter={() => {
            cancelClose();
            setVersionMenuOpen(true);
            setBookMenuOpen(false);
            setChapterMenuOpen(false);
          }}
          onMouseLeave={scheduleClose}
        >
          <span
            className="text-blue-600 hover:text-blue-800 cursor-default inline-block font-medium"
            aria-expanded={versionMenuOpen}
            aria-haspopup="listbox"
          >
            {VERSION_OPTIONS.find((o) => o.key === version)?.label ?? version}
          </span>
          {versionMenuOpen && (
            <div
              className="absolute left-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-2 min-w-[6rem]"
              role="listbox"
            >
              {VERSION_OPTIONS.map((opt) => (
                <Link
                  key={opt.key}
                  href={wholeBook ? wholePath(book, startChapterId, opt.key) : chapterPath(book, startChapterId, opt.key)}
                  className={`block px-2 py-1.5 text-sm rounded hover:bg-blue-50 text-left ${
                    opt.key === version ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                  }`}
                  role="option"
                >
                  {opt.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {pageInfo.totalPages > 1 && (
          <div className=" flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => setScrollToPageRequest(Math.max(0, pageInfo.currentPage - 1))}
              disabled={pageInfo.currentPage === 0}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ＜
            </button>
            <span className="text-gray-600">
              {pageInfo.currentPage + 1} / {pageInfo.totalPages}
            </span>
            <button
              type="button"
              onClick={() => setScrollToPageRequest(Math.min(pageInfo.totalPages - 1, pageInfo.currentPage + 1))}
              disabled={pageInfo.currentPage >= pageInfo.totalPages - 1}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ＞
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex gap-4">
        <div className="flex-1 min-w-0">
          <VerseDisplay
            chapters={book.chapters}
            startChapterId={startChapterId}
            onChapterChange={setCurrentChapter}
            onPageInfo={(currentPage, totalPages) => setPageInfo({ currentPage, totalPages })}
            scrollToPageRequest={scrollToPageRequest}
            onScrollToPageRequestHandled={handleScrollToPageRequestHandled}
            onActiveSectionId={handleActiveSectionId}
            paragraphInfo={paragraphInfo}
            wholeBook={wholeBook}
          />
        </div>
        {tocSections.length > 0 && (
          <aside className="flex-shrink-0 w-48 pt-2 overflow-y-auto max-h-full">
            <nav className="text-sm" aria-label="章节与段落目录">
              <ul className="space-y-1">
                {tocSections.map((item, i) => {
                  const anchorId = item.isChapterOnly
                    ? `ch-${item.chapterId}`
                    : `sect-${item.chapterId}-${item.startVerseNo ?? 1}-${slug(item.title)}`;
                  const verseRef = item.isChapterOnly ? `${item.chapterId}:1` : `${item.chapterId}:${item.startVerseNo ?? 1}`;
                  const label = item.isChapterOnly ? item.title : `${item.title} (${verseRef})`;
                  return (
                    <li key={`${item.chapterId}-${item.title}-${i}`}>
                      <button
                        type="button"
                        onClick={() => scrollToSection(anchorId)}
                        title={label}
                        className={`text-left w-full whitespace-nowrap overflow-hidden text-ellipsis hover:underline ${
                          activeSectionId === anchorId
                            ? 'text-blue-800 font-semibold bg-blue-50 rounded'
                            : 'text-blue-600 hover:text-blue-800'
                        }`}
                      >
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}
