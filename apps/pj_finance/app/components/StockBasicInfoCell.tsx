'use client';

import { useMemo } from 'react';

import type { ChainCompanyContext } from '../industryLink/chainCompanyContext';
import { getLevelColor } from '../industryLink/levelColor';
import { StockBasicMiniKLine, type KlineBar } from './StockBasicMiniKLine';

type StockInfo = {
  name: string;
  area: string;
  industry: string;
};

type MarketSnapshot = {
  trade_date: string | null;
  close: number | null;
  total_mv_yi: number | null;
  pe: number | null;
  pb: number | null;
};

type HotConceptsCellState =
  | { state: 'loading' }
  | { state: 'ready'; summary: string }
  | { state: 'error'; err: string };

export type StockBasicInfoCellProps = {
  seq: number;
  tsCode: string;
  loading: boolean;
  error?: string;
  stockInfo: StockInfo | null;
  marketSnapshot: MarketSnapshot | null;
  klineBars: KlineBar[];
  hot?: HotConceptsCellState;
  chainContext?: ChainCompanyContext;
  onOpenDetail: (tsCode: string, stockName?: string) => void;
};

const LINE_CLASS = 'shrink-0 min-w-max overflow-x-auto whitespace-nowrap text-[10px] leading-normal text-gray-700';

/** 60 日 K 线窗口：价倍比（最高/最低）、60日赔率（上方空间/下方空间） */
function computeKline60Metrics(
  bars: KlineBar[],
  currentClose: number | null | undefined,
): { priceMultiple: string; odds60: string } | null {
  if (bars.length === 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    if (Number.isFinite(b.high) && b.high > high) high = b.high;
    if (Number.isFinite(b.low) && b.low < low) low = b.low;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) return null;

  const price = currentClose ?? bars[bars.length - 1]?.close;
  if (!Number.isFinite(price)) return null;

  const priceMultiple = (high / low).toFixed(2);
  const upRoom = high - price;
  const downRoom = price - low;
  let odds60: string;
  if (downRoom <= 0) {
    odds60 = upRoom <= 0 ? '0.00' : '—';
  } else {
    odds60 = (upRoom / downRoom).toFixed(2);
  }

  return { priceMultiple, odds60 };
}

function LevelTag({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-gray-500">{label}:</span>
      <span style={{ color: getLevelColor(value), fontWeight: 700 }}>{value}</span>
    </>
  );
}

/** 股票基本信息：两行文字 + K线成交量（190px，与 IncomeChartCell 一致） */
export function StockBasicInfoCell({
  seq,
  tsCode,
  loading,
  error,
  stockInfo,
  marketSnapshot,
  klineBars,
  hot,
  chainContext,
  onOpenDetail,
}: StockBasicInfoCellProps) {
  const snap = marketSnapshot;
  const mv =
    snap?.total_mv_yi != null && Number.isFinite(snap.total_mv_yi)
      ? `${snap.total_mv_yi.toFixed(1)}亿`
      : '—';
  const price =
    snap?.close != null && Number.isFinite(snap.close) ? `${snap.close.toFixed(2)}元` : '—';
  const pe = snap?.pe != null && Number.isFinite(snap.pe) ? snap.pe.toFixed(2) : '—';
  const pb = snap?.pb != null && Number.isFinite(snap.pb) ? snap.pb.toFixed(2) : '—';

  const kline60Metrics = useMemo(
    () => computeKline60Metrics(klineBars, snap?.close),
    [klineBars, snap?.close],
  );

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-0.5 py-0.5">
      <div className={LINE_CLASS}>
        <span className="tabular-nums text-gray-400">{seq}</span>
        {' '}
        <button
          type="button"
          className="inline p-0 font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail(tsCode, stockInfo?.name);
          }}
        >
          {tsCode}
        </button>
        {' '}
        {loading ? (
          <span className="text-gray-500">加载中...</span>
        ) : error ? (
          <span className="text-red-500">{error}</span>
        ) : (
          <>
            {stockInfo ? (
              <>
                <span>名称:{stockInfo.name}</span>
                {' '}
                <span>所在地:{stockInfo.area}</span>
                {' '}
                <span>行业:{stockInfo.industry}</span>
              </>
            ) : (
              <span className="text-gray-500">无股票信息</span>
            )}
            {hot?.state === 'loading' ? (
              <>
                {' '}
                <span className="text-gray-500">热点:归纳中…</span>
              </>
            ) : hot?.state === 'error' ? (
              <>
                {' '}
                <span className="text-amber-800" title={hot.err}>热点:{hot.err}</span>
              </>
            ) : hot?.state === 'ready' ? (
              <>
                {' '}
                <span className="text-violet-950" title={hot.summary}>热点:{hot.summary || '—'}</span>
              </>
            ) : null}
          </>
        )}
      </div>
      {!loading && snap && (
        <div className={LINE_CLASS} title={snap.trade_date ? `行情 ${snap.trade_date}` : undefined}>
          <span>{mv}</span>
          {' '}
          <span>{price}</span>
          {' '}
          <span>PE:{pe}</span>
          {' '}
          <span>PB:{pb}</span>
        </div>
      )}
      {!loading && (
        <div className="h-[190px] w-full shrink-0">
          <StockBasicMiniKLine data={klineBars} />
        </div>
      )}
      {!loading && chainContext && (
        <>
          <div className={LINE_CLASS}>
            <span className="text-gray-500">子泳道:</span>
            <span>{chainContext.subLaneTitle}</span>
            {chainContext.subLaneCertainty ? (
              <>
                {' '}
                <LevelTag label="确定性" value={chainContext.subLaneCertainty} />
              </>
            ) : null}
            {chainContext.subLaneElasticity ? (
              <>
                {' '}
                <LevelTag label="弹性" value={chainContext.subLaneElasticity} />
              </>
            ) : null}
          </div>
          {(chainContext.companyCertainty || chainContext.companyElasticity) && (
            <div className={LINE_CLASS}>
              <span className="text-gray-500">公司:</span>
              {chainContext.companyCertainty ? (
                <>
                  {' '}
                  <LevelTag label="确定性" value={chainContext.companyCertainty} />
                </>
              ) : null}
              {chainContext.companyElasticity ? (
                <>
                  {' '}
                  <LevelTag label="弹性" value={chainContext.companyElasticity} />
                </>
              ) : null}
            </div>
          )}
        </>
      )}
      {!loading && kline60Metrics ? (
        <div
          className={LINE_CLASS}
          title="价倍比=60日最高/最低；60日赔率=(最高-现价)/(现价-最低)"
        >
          <span className="text-gray-500">价倍比:</span>
          <span className="font-semibold tabular-nums">{kline60Metrics.priceMultiple}</span>
          {' '}
          <span className="text-gray-500">60日赔率:</span>
          <span className="font-semibold tabular-nums">{kline60Metrics.odds60}</span>
        </div>
      ) : null}
    </div>
  );
}
