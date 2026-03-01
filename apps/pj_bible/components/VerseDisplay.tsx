'use client';

import { Chapter, Verse } from '@/types/bible';
import { ParagraphInfo } from '@/types/paragraph';
import { useEffect, useMemo, useRef, useState } from 'react';

interface VerseDisplayProps {
  chapters: Chapter[];
  startChapterId: number;
  onChapterChange?: (chapter: Chapter) => void;
  paragraphInfo?: ParagraphInfo[] | null;
  /** 全本模式：章节不换页 */
  wholeBook?: boolean;
}

export default function VerseDisplay({ chapters, startChapterId, onChapterChange, paragraphInfo, wholeBook }: VerseDisplayProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const chapterRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const updateVisibleChapterRef = useRef<() => void>(() => {});

  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Get chapters from startChapterId onwards - each chapter will start on a new page
  // 去重：避免 book.chapters 有重复时同一章渲染多次
  const chaptersToShow = useMemo(() => {
    const startIndex = chapters.findIndex((ch) => ch.id === startChapterId);
    if (startIndex === -1) return [];
    const sliced = chapters.slice(startIndex);
    const seen = new Set<number>();
    return sliced.filter((ch) => {
      if (seen.has(ch.id)) return false;
      seen.add(ch.id);
      return true;
    });
  }, [chapters, startChapterId]);

  const updateVisibleChapter = () => {
    const scroller = scrollerRef.current;
    if (!scroller || !onChapterChange || chaptersToShow.length === 0) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const viewportCenter = scrollerRect.left + scrollerRect.width / 2;

    // Find the chapter whose content contains the viewport center
    // Iterate in DOM order (chaptersToShow order) and find the last one that starts before center
    let visibleChapter: Chapter | null = chaptersToShow[0];
    for (const chapter of chaptersToShow) {
      const el = chapterRefsMap.current.get(chapter.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.left <= viewportCenter) {
        visibleChapter = chapter;
      }
    }
    onChapterChange(visibleChapter);
  };
  updateVisibleChapterRef.current = updateVisibleChapter;

  // Get paragraph records for a chapter (when paragraphInfo is present, e.g. Romans)
  // 去重：按 (chapter, paragraph) 去重，避免 API 返回重复记录
  /** 用于锚点 id：标题转成 URL 安全字符串 */
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'sect';

  const getParagraphsForChapter = (chapterId: number): ParagraphInfo[] => {
    if (!paragraphInfo) return [];
    const filtered = paragraphInfo.filter((p) => p.chapter === chapterId);
    const seen = new Set<string>();
    return filtered.filter((p) => {
      const key = `${p.chapter}-${p.paragraph}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const renderVerse = (verse: Verse) => (
    <span key={verse.id} className="inline break-inside-avoid mr-3">
      {/* <span className="font-semibold text-blue-600 mr-2">{verse.id}</span> */}
      <span className="text-gray-900">{verse.text}</span>
    </span>
  );


  // Render each chapter: with paragraph structure when paragraphInfo exists, else flat verses
  const verseSpans = useMemo(() => {
    return chaptersToShow.map((chapter, chapterIndex) => {
      const paragraphs = getParagraphsForChapter(chapter.id);
      const hasParagraphs = paragraphs.length > 0;

      const chapterContent = hasParagraphs ? (() => {
        const renderedVerseIds = new Set<number>();
        return paragraphs
          .map((para, paraIndex) => {
            const versesInPara = chapter.verses.filter(
              (v) => v.id >= para.startVerseNo && v.id <= para.endVerseNo
            );
            // 避免重叠段落导致同一经文重复显示：只渲染尚未渲染的经文
            const versesToRender = versesInPara.filter((v) => {
              if (renderedVerseIds.has(v.id)) return false;
              renderedVerseIds.add(v.id);
              return true;
            });
            if (versesToRender.length === 0) return null;
            const showTitle = paraIndex === 0 || paragraphs[paraIndex - 1].title !== para.title;
            const titleToShow = para.title && para.title !== '(无小标题)' ? para.title : null;
            const isFirstPara = paraIndex === 0;

            return (
              <div
                key={`${chapter.id}-${para.paragraph}`}
                id={showTitle && titleToShow ? `sect-${chapter.id}-${slug(titleToShow)}` : undefined}
                className="mb-4 first:mt-0"
              >
                {showTitle && titleToShow && (
                  <div className="font-bold text-gray-800 mb-2">{titleToShow}</div>
                )}
                <div
                  className="leading-relaxed"
                  style={isFirstPara ? { textIndent: '2em' } : undefined}
                >
                  {isFirstPara && (
                    <span className="text-xl font-bold text-gray-800 mr-2">{chapter.id}</span>
                  )}
                  {versesToRender.map(renderVerse)}
                </div>
              </div>
            );
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
      })() : (
        <div className="leading-relaxed" style={{ textIndent: '2em' }}>
          <span className="text-xl font-bold text-gray-800 mr-2">{chapter.id}</span>
          {chapter.verses.map(renderVerse)}
        </div>
      );

      return (
        <div
          key={chapter.id}
          id={`ch-${chapter.id}`}
          ref={(el) => {
            if (el) chapterRefsMap.current.set(chapter.id, el);
            else chapterRefsMap.current.delete(chapter.id);
          }}
          className={wholeBook ? '' : 'break-after-avoid'}
          style={{
            ...({paddingRight: '32px',paddingLeft: '32px'}),
            ...(!wholeBook && chapterIndex > 0 ? { breakBefore: 'column' } : {}),
            scrollSnapAlign: 'start',
          }}
        >
          {hasParagraphs ? chapterContent : <>{chapterContent}</>}
        </div>
      );
    });
  }, [chaptersToShow, paragraphInfo, wholeBook]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    const updateLayout = () => {
      // Get container dimensions
      const containerWidth = scroller.clientWidth;
      const containerHeight = scroller.clientHeight;

      if (containerWidth === 0 || containerHeight === 0) return;

      // Get actual padding from computed styles
      const computedStyle = window.getComputedStyle(scroller);
      const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
      const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
      const availableHeight = containerHeight - paddingTop - paddingBottom;
      
      // Set page width (each column/page fills the container width)
      content.style.setProperty('--page-width', `${containerWidth}px`);
      
      // Set content height to available height so CSS columns paginate correctly
      // Content will flow vertically first, then create new columns horizontally when height is exceeded
      content.style.height = `${availableHeight}px`;
      content.style.maxHeight = `${availableHeight}px`;
      
      // Force a reflow to ensure CSS columns recalculate with new height
      void content.offsetHeight;
      setTimeout(() => {
        // CSS columns layout 需要多帧才能完成，用双 rAF 等待 scrollWidth 稳定后再计算页数
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const columnWidth =
              parseFloat(getComputedStyle(content).getPropertyValue('--page-width') || '0') ||
              scroller.clientWidth;
            const columnGap = parseFloat(getComputedStyle(content).columnGap) || 32;
            const scrollWidth = scroller.scrollWidth;
            const effectivePageWidth = columnWidth + columnGap;
            const pages = Math.max(1, Math.ceil((scrollWidth + columnGap) / effectivePageWidth));
            setTotalPages(pages);

            setCurrentPage((p) => Math.min(pages - 1, Math.max(0, p)));
            updateVisibleChapterRef.current();
          });
        });
      },100)
    };

    updateLayout();
    // 当scroller被观察到scroll时，upateLayout
    const ro = new ResizeObserver(updateLayout);
    ro.observe(scroller);

    return () => ro.disconnect();
  }, [chaptersToShow]);

  const getPageWidth = (element: HTMLDivElement): number => {
    const computedStyle = window.getComputedStyle(element);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    return element.clientWidth - paddingLeft;
  };

  // 每页宽度 = columnWidth + columnGap
  const getEffectivePageWidth = (scrollerEl: HTMLDivElement, contentEl: HTMLDivElement): number => {
    const columnWidth =
      parseFloat(getComputedStyle(contentEl).getPropertyValue('--page-width') || '0') ||
      scrollerEl.clientWidth;
    const columnGap = parseFloat(getComputedStyle(contentEl).columnGap) || 32;
    return columnWidth + columnGap;
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const content = contentRef.current;
        const effectivePageWidth = content
          ? getEffectivePageWidth(scroller, content)
          : getPageWidth(scroller);
        setCurrentPage(Math.round(scroller.scrollLeft / effectivePageWidth));
        updateVisibleChapterRef.current();
      });
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, []);

  const scrollToPage = (page: number) => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const effectivePageWidth = getEffectivePageWidth(scroller, content);
    scroller.scrollTo({ left: page * effectivePageWidth, behavior: 'smooth' });
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div
        ref={scrollerRef}
        className="bg-white rounded-lg shadow-sm flex-1 min-h-0 overflow-x-auto overflow-y-hidden scrollbar-hide"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        <div
          ref={contentRef}
          className="text-lg leading-relaxed "
          // p-6 md:p-8
          style={{
            columnWidth: 'var(--page-width)',
            columnGap: '2rem',
            height: '100%',
            columnFill: 'auto',
          }}
        >
          {verseSpans}
        </div>
      </div>

      {totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => scrollToPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            上一頁
          </button>
          <span className="text-gray-600">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => scrollToPage(Math.min(totalPages - 1, currentPage + 1))}
            disabled={currentPage >= totalPages - 1}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一頁
          </button>
        </div>
      ) : null}
    </div>
  );
}
