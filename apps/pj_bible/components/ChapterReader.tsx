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
  const [showVerseNumbers, setShowVerseNumbers] = useState(false);
  /** 右侧小标题目录显隐（有目录数据时显示切换按钮） */
  const [showTitleList, setShowTitleList] = useState(true);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  /** 用户点击 TOC 的 section，以点击为准高亮；滚动导致可见段变化时清除，改用滚动首可见 */
  const [lastClickedSectionId, setLastClickedSectionId] = useState<string | null>(null);
  const isProgrammaticScrollRef = useRef(false);

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
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
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

  /** 去掉标题中所有 () / [] 包裹内容，并压缩空格 */
  const cleanTitle = (s: string) =>
    (s ?? '')
      .replace(/\s*(\([^)]*\)|\[[^\]]*\])\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

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
        const currentTitle = cleanTitle(para.title ?? '');
        const prevTitle = i === 0 ? '' : cleanTitle(deduped[i - 1].title ?? '');
        const showTitle = i === 0 || prevTitle !== currentTitle;
        const titleToShow = currentTitle && currentTitle !== '(无小标题)' ? currentTitle : null;
        if (showTitle && titleToShow) {
          out.push({ chapterId: ch.id, title: titleToShow, isChapterOnly: false, startVerseNo: para.startVerseNo });
        }
      }
    }
    return out;
  })();

  const scrollToSection = (anchorId: string) => {
    // 1. 设置标记：告诉系统这是程序触发的滚动
    isProgrammaticScrollRef.current = true;
    // console.log('scrollToSection', anchorId);
    // console.log('scrollToSection 222 setLastClickedSectionId：', lastClickedSectionId,'anchorId:',anchorId);
    const el = document.getElementById(anchorId);
    if(el){
    el?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'start' });

      // 2. 释放标记：
      // 如果 behavior 是 'instant'，滚动几乎是同步完成的
      // 如果是 'smooth'，则需要监听 scrollend 事件或使用 setTimeout
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        setLastClickedSectionId(anchorId);
      }, 50);
    }
  };

  const handleScrollToPageRequestHandled = () => setScrollToPageRequest(null);
  /** 滚动时由 VerseDisplay 调用。若当前是点击态且报上来的 id 与点击的一致，不更新，避免点击触发的滚动覆盖高亮；否则按滚动结果更新并清除点击态 */
  const handleActiveSectionId = (id: string | null) => {
    // console.log('handleActiveSectionId 222', id, 'lastClickedSectionId 222', lastClickedSectionId, 'isProgrammaticScrollRef.current', isProgrammaticScrollRef.current);
    if (isProgrammaticScrollRef.current) {
      return;
    }
    setActiveSectionId(id);
    setLastClickedSectionId(null);
  };

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-4rem)] flex flex-col px-2">
      <div className="flex-shrink-0 pt-2 pb-2 flex flex-col gap-y-2">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        {allBooks ? (
          <>
            <Link
              href={`/book/${book.id}`}
              className="text-blue-600 hover:text-blue-800"
            >
              ← 返回
            </Link>
            {/* 换书组件 */}
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
        {/* 换章节组件 */}
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

        {/* 换版本组件 */}
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
          </div>
          {tocSections.length > 0 && (
            <button
              type="button"
              onClick={() => setShowTitleList((v) => !v)}
              className="flex-shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded border border-blue-200 hover:bg-blue-50"
              aria-expanded={showTitleList}
              aria-controls="chapter-toc"
            >
              {showTitleList ? '收起目录' : '显示目录'}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* 换页面组件 */}
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
        {/* 显示节号开关 */}
        <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none ml-2">
          <span className="text-gray-600">显示节号</span>
          <button
            type="button"
            role="switch"
            aria-checked={showVerseNumbers}
            onClick={() => setShowVerseNumbers((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              showVerseNumbers ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                showVerseNumbers ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>
        </div>
      </div>
        {/* 书本内容 */}
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
            showVerseNumbers={showVerseNumbers}
          />
        </div>
        {showTitleList && tocSections.length > 0 && (
          <aside
            id="chapter-toc"
            className="flex-shrink-0 w-48 pt-2 overflow-y-auto max-h-full"
          >
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
                          (lastClickedSectionId ?? activeSectionId) === anchorId
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
