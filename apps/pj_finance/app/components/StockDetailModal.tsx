'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CninfoStockRecentInfoPanel } from './CninfoStockRecentInfoPanel';
import { StockFinancialStatementPanel } from './StockFinancialStatementsPanel';
import KLineChart from './KLineChart';
import { useModalPortalRoot } from '@/app/lib/useModalPortalRoot';

export type StockDetailTab = 'cninfo' | 'kline' | 'balance' | 'income' | 'cashflow';

export type StockDetailModalProps = {
  open: boolean;
  tsCode: string;
  stockName?: string;
  defaultTab?: StockDetailTab;
  onClose: () => void;
};

const TAB_CONTENT_CLASS =
  'absolute inset-0 mt-0 flex min-h-0 flex-col overflow-hidden focus-visible:outline-none data-[state=inactive]:hidden';

function StockKLinePanel({ tsCode }: { tsCode: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(480);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setChartHeight(Math.max(320, Math.floor(entry.contentRect.height)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full min-h-0 w-full">
      <KLineChart tsCode={tsCode} height={chartHeight} />
    </div>
  );
}

export function StockDetailModal({
  open,
  tsCode,
  stockName,
  defaultTab = 'cninfo',
  onClose,
}: StockDetailModalProps) {
  const portalRoot = useModalPortalRoot();
  const [tab, setTab] = useState<StockDetailTab>(defaultTab);
  const [visited, setVisited] = useState<Set<StockDetailTab>>(() => new Set([defaultTab]));

  useEffect(() => {
    if (!open) return;
    setTab(defaultTab);
    setVisited(new Set([defaultTab]));
  }, [open, tsCode, defaultTab]);

  const onTabChange = (value: string) => {
    const next = value as StockDetailTab;
    setTab(next);
    setVisited((prev) => {
      if (prev.has(next)) return prev;
      const copy = new Set(prev);
      copy.add(next);
      return copy;
    });
  };

  if (!open || typeof document === 'undefined' || !portalRoot) return null;

  const titleMain = stockName?.trim()
    ? `${tsCode} · ${stockName.trim()}`
    : tsCode;

  return createPortal(
    <div
      className="fixed inset-0 z-[1410] flex items-start justify-center bg-black/40 pt-4 pb-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-[calc(100vh-2rem)] w-[min(1200px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="min-w-0 pr-4">
            <div className="text-sm font-semibold text-gray-900">证券详情</div>
            <div className="truncate text-xs text-gray-500">{titleMain}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <Tabs
          value={tab}
          onValueChange={onTabChange}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <TabsList className="mx-4 mt-2 h-9 w-fit shrink-0">
            <TabsTrigger value="cninfo">巨潮消息</TabsTrigger>
            <TabsTrigger value="kline">K线</TabsTrigger>
            <TabsTrigger value="balance">资产负债表</TabsTrigger>
            <TabsTrigger value="income">利润表</TabsTrigger>
            <TabsTrigger value="cashflow">现金流量表</TabsTrigger>
          </TabsList>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            <TabsContent value="cninfo" className={TAB_CONTENT_CLASS}>
              {visited.has('cninfo') ? (
                <CninfoStockRecentInfoPanel tsCode={tsCode} active={open && tab === 'cninfo'} />
              ) : null}
            </TabsContent>

            <TabsContent value="kline" className={TAB_CONTENT_CLASS}>
              {visited.has('kline') ? <StockKLinePanel tsCode={tsCode} /> : null}
            </TabsContent>

            <TabsContent value="balance" className={TAB_CONTENT_CLASS}>
              {visited.has('balance') ? (
                <StockFinancialStatementPanel
                  tsCode={tsCode}
                  report="balance"
                  active={open && tab === 'balance'}
                />
              ) : null}
            </TabsContent>

            <TabsContent value="income" className={TAB_CONTENT_CLASS}>
              {visited.has('income') ? (
                <StockFinancialStatementPanel
                  tsCode={tsCode}
                  report="income"
                  active={open && tab === 'income'}
                />
              ) : null}
            </TabsContent>

            <TabsContent value="cashflow" className={TAB_CONTENT_CLASS}>
              {visited.has('cashflow') ? (
                <StockFinancialStatementPanel
                  tsCode={tsCode}
                  report="cashflow"
                  active={open && tab === 'cashflow'}
                />
              ) : null}
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>,
    portalRoot,
  );
}
