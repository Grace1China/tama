'use client';

import { Chapter, Verse } from '@/types/bible';
import { ParagraphInfo } from '@/types/paragraph';
import { useEffect, useMemo, useRef, useState } from 'react';

interface VerseDisplayProps {
  chapters: Chapter[];
  startChapterId: number;
  onChapterChange?: (chapter: Chapter) => void;
  /** 页码变化时回调，供父组件在面包屑旁渲染分页 */
  onPageInfo?: (currentPage: number, totalPages: number) => void;
  /** 父组件请求滚动到某页，执行后调用 onScrollToPageRequestHandled */
  scrollToPageRequest?: number | null;
  onScrollToPageRequestHandled?: () => void;
  /** 当前视口内第一个可见的段落/章节 id（用于右侧目录高亮） */
  onActiveSectionId?: (id: string | null) => void;
  paragraphInfo?: ParagraphInfo[] | null;
  /** 全本模式：章节不换页 */
  wholeBook?: boolean;
  /** 是否显示每节经文编号 */
  showVerseNumbers?: boolean;
  /** true：单列纵向滚动，不使用 CSS columns 与横向分页（移动端专用路由） */
  mobileReader?: boolean;
}

export default function VerseDisplay({
  chapters,
  startChapterId,
  onChapterChange,
  onPageInfo,
  scrollToPageRequest,
  onScrollToPageRequestHandled,
  onActiveSectionId,
  paragraphInfo,
  wholeBook,
  showVerseNumbers,
  mobileReader = false,
}: VerseDisplayProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const chapterRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const updateVisibleChapterRef = useRef<() => void>(() => {});

  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedWordResult, setSelectedWordResult] = useState<string | null>(null);
  const [selectedWordLoading, setSelectedWordLoading] = useState(false);
  const [selectedWordError, setSelectedWordError] = useState<string | null>(null);
  const [selectedWordPos, setSelectedWordPos] = useState<{
    top: number;
    left: number;
    placement: 'above' | 'below';
  } | null>(null);
  const wordCacheRef = useRef<Map<string, string>>(new Map());
  const wordPopupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('wordLookupCache');
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<string, string>;
      const map = new Map<string, string>();
      Object.entries(obj).forEach(([k, v]) => {
        if (typeof v === 'string') {
          map.set(k, v);
        }
      });
      wordCacheRef.current = map;
    } catch {
      // ignore
    }
  }, []);

  const saveWordCacheToStorage = () => {
    if (typeof window === 'undefined') return;
    const obj: Record<string, string> = {};
    wordCacheRef.current.forEach((v, k) => {
      obj[k] = v;
    });
    try {
      window.localStorage.setItem('wordLookupCache', JSON.stringify(obj));
    } catch {
      // ignore quota or JSON errors
    }
  };

  useEffect(() => {
    if (!selectedWord) return;
    if (typeof window === 'undefined') return;
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (!wordPopupRef.current) return;
      const target = event.target as Node | null;
      if (target && wordPopupRef.current.contains(target)) {
        return;
      }
      setSelectedWord(null);
      setSelectedWordResult(null);
      setSelectedWordError(null);
      setSelectedWordPos(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [selectedWord]);

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

    if (mobileReader) {
      /** 纵向滚动：以视口竖直中线所在章为高亮当前章 */
      const viewportCenterY = scrollerRect.top + scrollerRect.height / 2;
      let visibleChapter: Chapter | null = chaptersToShow[0];
      for (const chapter of chaptersToShow) {
        const el = chapterRefsMap.current.get(chapter.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= viewportCenterY) {
          visibleChapter = chapter;
        }
      }
      onChapterChange(visibleChapter);
      return;
    }

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

  const updateActiveSection = () => {
    // console.log('updateActiveSection');
    if (!onActiveSectionId) return;
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const findFirstVisibleH = (selector: string): string | null => {
      const sections = content.querySelectorAll<HTMLElement>(selector);
      for (const el of sections) {
        const r = el.getBoundingClientRect();
        if (r.left < scrollerRect.right && r.right > scrollerRect.left) {
          return el.id;
        }
      }
      return null;
    };
    /** 纵向滚动时按竖直带状区域判断首可见标题 */
    const findFirstVisibleV = (selector: string): string | null => {
      const sections = content.querySelectorAll<HTMLElement>(selector);
      const inset = Math.min(scrollerRect.height * 0.08, 48);
      const bandTop = scrollerRect.top + inset;
      const bandBottom = scrollerRect.bottom - inset;
      for (const el of sections) {
        const r = el.getBoundingClientRect();
        if (r.bottom > bandTop && r.top < bandBottom) {
          return el.id;
        }
      }
      return null;
    };
    // 优先使用段落标题（sect-xxx-xxx-...），找不到时再退回整章容器（ch-xxx）
    const sectId = mobileReader
      ? findFirstVisibleV('[id^="sect-"]')
      : findFirstVisibleH('[id^="sect-"]');
    if (sectId) {
      // console.log('updateActiveSection 111', sectId);
      onActiveSectionId(sectId);
      return;
    }
    // const chId = findFirstVisible('[id^="ch-"]');
    // if (chId) {
    //   onActiveSectionId(chId);
    //   return;
    // }
    // onActiveSectionId(null);
  };

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
      {showVerseNumbers && (
        <sup className="font-semibold text-blue-600 mr-1 text-xs">{verse.id}</sup>
      )}
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
            // 显示时去掉所有括号/方括号包裹的内容（无论在中间还是结尾），如 "(A)"、"(NIV)"、"[A]"
            const titleDisplay =
              titleToShow
                ?.replace(/\s*(\([^)]*\)|\[[^\]]*\])\s*/g, ' ')
                .replace(/\s+/g, ' ')
                .trim() ?? titleToShow;
            const isFirstPara = paraIndex === 0;
            const anchorId =
              showTitle && titleToShow
                ? `sect-${chapter.id}-${para.startVerseNo}-${slug(titleToShow)}`
                : undefined;

            return (
              <div
                key={`${chapter.id}-${para.paragraph}`}
                className="mb-4 first:mt-0"
              >
                {showTitle && titleToShow && (
                  <div id={anchorId} className="font-bold text-gray-800 mb-2">
                    {titleDisplay}
                  </div>
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
            /** 移动端与 ChapterReader 的 px-2 对齐，不再额外两侧 32px，避免经文比 toolbar 文字更「缩进」 */
            ...(mobileReader ? {} : { paddingRight: '32px', paddingLeft: '32px' }),
            ...(mobileReader
              ? {}
              : {
                  ...(!wholeBook && chapterIndex > 0 ? { breakBefore: 'column' as const } : {}),
                  scrollSnapAlign: 'start' as const,
                }),
          }}
        >
          {hasParagraphs ? chapterContent : <>{chapterContent}</>}
        </div>
      );
    });
  }, [chaptersToShow, paragraphInfo, wholeBook, showVerseNumbers, mobileReader]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    const updateLayout = () => {
      if (mobileReader) {
        content.style.height = '';
        content.style.maxHeight = '';
        content.style.columnWidth = '';
        content.style.columnGap = '';
        content.style.columnFill = '';
        setTotalPages(1);
        setCurrentPage(0);
        requestAnimationFrame(() => {
          updateVisibleChapterRef.current();
          updateActiveSection();
        });
        return;
      }

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
            updateActiveSection();
          });
        });
      },100)
    };

    updateLayout();
    // 当scroller被观察到scroll时，upateLayout
    const ro = new ResizeObserver(updateLayout);
    ro.observe(scroller);

    return () => ro.disconnect();
  }, [chaptersToShow, mobileReader]);

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
      // console.log('onScroll');
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!mobileReader) {
          const content = contentRef.current;
          const effectivePageWidth = content
            ? getEffectivePageWidth(scroller, content)
            : getPageWidth(scroller);
          setCurrentPage(Math.round(scroller.scrollLeft / effectivePageWidth));
        }
        updateVisibleChapterRef.current();
        updateActiveSection();
      });
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [mobileReader]);

  const scrollToPage = (page: number) => {
    if (mobileReader) return;
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const effectivePageWidth = getEffectivePageWidth(scroller, content);
    scroller.scrollTo({ left: page * effectivePageWidth, behavior: 'instant' });
  };

  useEffect(() => {
    onPageInfo?.(currentPage, totalPages);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在页码变化时通知父组件，避免回调引用变化导致无限循环
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (scrollToPageRequest == null) return;
    if (mobileReader) {
      onScrollToPageRequestHandled?.();
      return;
    }
    scrollToPage(scrollToPageRequest);
    onScrollToPageRequestHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅响应 scrollToPageRequest 变化，避免因回调引用重复滚动
  }, [scrollToPageRequest, mobileReader]);

  const handleSelectionLookup = async () => {
    if (typeof window === 'undefined') return;
    const sel = window.getSelection();
    if (!sel) return;
    const text = sel.toString().trim();
    if (!text) return;
    const match = text.match(/[A-Za-z']+/);
    const word = match?.[0];
    if (!word) return;

    const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const rect = range ? range.getBoundingClientRect() : null;
    if (!rect) return;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const placeBelow = rect.top < viewportHeight / 2;
    const offset = 8;
    const margin = 12;

    let top = placeBelow ? rect.bottom + offset : rect.top - offset;
    let left = rect.left + rect.width / 2;

    if (left < margin) left = margin;
    if (left > viewportWidth - margin) left = viewportWidth - margin;

    setSelectedWord(word);
    setSelectedWordPos({
      top,
      left,
      placement: placeBelow ? 'below' : 'above',
    });
    setSelectedWordLoading(true);
    setSelectedWordError(null);
    setSelectedWordResult(null);

    const cached = wordCacheRef.current.get(word.toLowerCase());
    if (cached) {
      setSelectedWordResult(cached);
      setSelectedWordLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/word-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const textResult: string = data.text ?? data.meaning ?? '';
      setSelectedWordResult(textResult);
      wordCacheRef.current.set(word.toLowerCase(), textResult);
      saveWordCacheToStorage();
    } catch (err) {
      console.error('word lookup error', err);
      setSelectedWordError('查询失败，请稍后再试');
    } finally {
      setSelectedWordLoading(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div
        ref={scrollerRef}
        className={
          mobileReader
            ? 'bg-white flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide touch-pan-y rounded-none shadow-none'
            : 'bg-white rounded-lg shadow-sm flex-1 min-h-0 overflow-x-auto overflow-y-hidden scrollbar-hide'
        }
        style={
          mobileReader
            ? { overscrollBehaviorY: 'contain' }
            : { scrollSnapType: 'x mandatory', overscrollBehaviorX: 'none' }
        }
        onPointerUp={handleSelectionLookup}
      >
        <div
          ref={contentRef}
          className={`text-lg leading-relaxed ${mobileReader ? 'w-full max-w-full pb-8' : ''}`}
          style={
            mobileReader
              ? undefined
              : {
                  columnWidth: 'var(--page-width)',
                  columnGap: '2rem',
                  height: '100%',
                  columnFill: 'auto',
                }
          }
        >
          {verseSpans}
        </div>
      </div>
      {selectedWord && selectedWordPos && (
        <div
          ref={wordPopupRef}
          className="fixed max-w-sm bg-white border border-gray-200 shadow-lg rounded-lg p-3 text-sm z-50"
          style={{
            top: selectedWordPos.top,
            left: selectedWordPos.left,
            transform:
              selectedWordPos.placement === 'above'
                ? 'translate(-50%, -100%)'
                : 'translateX(-50%)',
          }}
        >
          <div className="flex justify-between items-center mb-1">
            <span className="font-semibold text-gray-800">{selectedWord}</span>
            <button
              type="button"
              className="ml-2 text-gray-400 hover:text-gray-700"
              onClick={() => {
                setSelectedWord(null);
                setSelectedWordResult(null);
                setSelectedWordError(null);
                setSelectedWordPos(null);
              }}
            >
              ×
            </button>
          </div>
          {selectedWordLoading && <div className="text-gray-500">查询中...</div>}
          {!selectedWordLoading && selectedWordError && (
            <div className="text-red-500">{selectedWordError}</div>
          )}
          {!selectedWordLoading && !selectedWordError && (
            <div className="text-gray-800 whitespace-pre-wrap">
              {selectedWordResult || '没有返回结果'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
