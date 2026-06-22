'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface OHLCData {
  ts_code: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
  amount: number;
}

interface KLineChartProps {
  tsCode: string;
  height?: number;
}

const HEADER_H = 34;
const CONTROL_H = 32;
const SLIDER_H = 28;

/** 格式化 YYYYMMDD → YY/MM/DD */
function fmtDate(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd;
  return `${ymd.slice(2, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
}

/** 格式化金额（万元 → 亿） */
function fmtYi(v: number): string {
  return (v / 10000).toFixed(2) + '亿';
}

/** 从 YYYYMMDD 字符串生成 Date */
function toDate(ymd: string): Date {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6)) - 1;
  const d = Number(ymd.slice(6, 8));
  return new Date(y, m, d);
}

/** 从 Date 生成 YYYYMMDD */
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** 预设时间跨度 */
const PRESETS: { label: string; months: number }[] = [
  { label: '1月', months: 1 },
  { label: '3月', months: 3 },
  { label: '6月', months: 6 },
  { label: '1年', months: 12 },
  { label: '3年', months: 36 },
  { label: '全部', months: 0 },
];

export default function KLineChart({ tsCode, height = 420 }: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotWrapRef = useRef<HTMLDivElement>(null);
  const [fullData, setFullData] = useState<OHLCData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [plotWidth, setPlotWidth] = useState(800);

  const plotH = Math.max(120, height - HEADER_H - CONTROL_H - SLIDER_H);

  // 日期范围（YYYYMMDD 字符串）
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tsCode) { setFullData([]); setRangeStart(''); setRangeEnd(''); return; }
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/parq/qfqDir?ts_code=${encodeURIComponent(tsCode)}&page=1&size=1000000&sortField=trade_date&sortDir=asc&start_date=20140101`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || '请求失败');
        if (cancelled) return;
        const rows: OHLCData[] = (json.data || []).filter(
          (r: any) => r.open != null && r.high != null && r.low != null && r.close != null
        );
        setFullData(rows);
        if (rows.length > 0) {
          setRangeStart(String(rows[0].trade_date));
          setRangeEnd(String(rows[rows.length - 1].trade_date));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '获取数据失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [tsCode]);

  const data = useMemo(() => {
    if (!rangeStart && !rangeEnd) return fullData;
    return fullData.filter((d) => {
      const date = String(d.trade_date);
      if (rangeStart && date < rangeStart) return false;
      if (rangeEnd && date > rangeEnd) return false;
      return true;
    });
  }, [fullData, rangeStart, rangeEnd]);

  useEffect(() => {
    const el = plotWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setPlotWidth(Math.max(200, e.contentRect.width));
      }
    });
    ro.observe(el);
    setPlotWidth(Math.max(200, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const margin = { top: 8, right: 12, bottom: 16, left: 52 };
  const volH = Math.round((plotH - margin.top - margin.bottom) * 0.22);
  const mainH = plotH - margin.top - margin.bottom - volH - 4;
  const mainW = plotWidth - margin.left - margin.right;
  const w = plotWidth;

  const priceRange = useMemo(() => {
    if (!data.length) return { min: 0, max: 100, range: 100 };
    let min = Infinity;
    let max = -Infinity;
    for (const d of data) {
      if (d.low < min) min = d.low;
      if (d.high > max) max = d.high;
    }
    const pad = (max - min) * 0.06 || 1;
    return { min: min - pad, max: max + pad, range: max - min + pad * 2 };
  }, [data]);

  const volMax = useMemo(() => {
    if (!data.length) return 1;
    let m = 0;
    for (const d of data) if (d.vol > m) m = d.vol;
    return m || 1;
  }, [data]);

  const toX = useCallback(
    (i: number) => margin.left + (i / Math.max(data.length - 1, 1)) * mainW,
    [margin.left, mainW, data.length],
  );
  const toY = useCallback(
    (price: number) => margin.top + (1 - (price - priceRange.min) / priceRange.range) * mainH,
    [margin.top, mainH, priceRange],
  );
  const toVolY = useCallback(
    (v: number) => margin.top + mainH + 4 + (1 - v / volMax) * volH,
    [margin.top, mainH, volMax, volH],
  );

  const candleW = useMemo(
    () => Math.max(1, Math.min(12, (mainW / Math.max(data.length, 1)) * 0.65)),
    [mainW, data.length],
  );
  const candleGap = useMemo(() => mainW / Math.max(data.length, 1), [mainW, data.length]);

  const yTicks = useMemo(() => {
    const n = 5;
    const ticks: number[] = [];
    for (let i = 0; i <= n; i++) {
      ticks.push(priceRange.min + (priceRange.range * i) / n);
    }
    return ticks;
  }, [priceRange]);

  const xLabels = useMemo(() => {
    const labels: { idx: number; label: string }[] = [];
    let lastYear = '';
    data.forEach((d, i) => {
      const y = String(d.trade_date).slice(0, 4);
      if (y !== lastYear) {
        labels.push({ idx: i, label: y });
        lastYear = y;
      }
    });
    return labels;
  }, [data]);

  /** 鼠标坐标换算到 viewBox（修复 width=100% 与 viewBox 不一致时的焦点偏移） */
  const onMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return;
      const sx = ((e.clientX - rect.left) / rect.width) * w;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < data.length; i++) {
        const cx = toX(i) + candleGap / 2;
        const dist = Math.abs(sx - cx);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      setHoverIdx(bestIdx);
    },
    [data, toX, candleGap, w],
  );

  const handlePreset = useCallback((months: number) => {
    if (months === 0 || !fullData.length) {
      setRangeStart(String(fullData[0]?.trade_date ?? ''));
      setRangeEnd(String(fullData[fullData.length - 1]?.trade_date ?? ''));
      return;
    }
    const endDate = toDate(String(fullData[fullData.length - 1].trade_date));
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - months);
    setRangeStart(toYMD(startDate));
    setRangeEnd(toYMD(endDate));
  }, [fullData]);

  const sliderFromIdx = useCallback((ymd: string) => {
    const idx = fullData.findIndex((d) => String(d.trade_date) >= ymd);
    return idx >= 0 ? idx : 0;
  }, [fullData]);
  const sliderToIdx = useCallback((ymd: string) => {
    const idx = fullData.findIndex((d) => String(d.trade_date) > ymd);
    return idx > 0 ? idx - 1 : Math.max(fullData.length - 1, 0);
  }, [fullData]);

  const sliderStartIdx = rangeStart ? sliderFromIdx(rangeStart) : 0;
  const sliderEndIdx = rangeEnd ? sliderToIdx(rangeEnd) : Math.max(fullData.length - 1, 0);
  const sliderLen = Math.max(fullData.length, 1);

  const sliderToPct = useCallback((idx: number) => (idx / Math.max(sliderLen - 1, 1)) * 100, [sliderLen]);
  const sliderFromPct = useCallback(
    (pct: number) => Math.round((pct / 100) * Math.max(sliderLen - 1, 0)),
    [sliderLen],
  );

  const onSliderMouseDown = useCallback((which: 'start' | 'end') => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(which);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = sliderRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const idx = sliderFromPct(pct);
      const ymd = String(fullData[idx]?.trade_date ?? '');
      if (!ymd) return;
      if (dragging === 'start' && ymd < (rangeEnd || '99999999')) setRangeStart(ymd);
      if (dragging === 'end' && ymd > (rangeStart || '00000000')) setRangeEnd(ymd);
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, fullData, rangeStart, rangeEnd, sliderFromPct]);

  if (!tsCode) {
    return (
      <div className="flex w-full items-center justify-center rounded-lg border border-gray-200 bg-gray-50" style={{ height }}>
        <p className="text-gray-500">请选择股票代码查看 K 线</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex w-full items-center justify-center rounded-lg border border-gray-200 bg-gray-50" style={{ height }}>
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full items-center justify-center rounded-lg border border-red-200 bg-red-50" style={{ height }}>
        <p className="text-red-500">错误: {error}</p>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex w-full items-center justify-center rounded-lg border border-gray-200 bg-gray-50" style={{ height }}>
        <p className="text-gray-500">暂无数据</p>
      </div>
    );
  }

  const hoverD = hoverIdx != null ? data[hoverIdx] : null;
  const isUp = (d: OHLCData) => d.close >= d.open;
  const candleColor = (up: boolean) => (up ? '#ef5350' : '#26a69a');
  const volColor = (up: boolean) => (up ? 'rgba(239,83,80,0.35)' : 'rgba(38,166,154,0.35)');
  const changePct = data.length >= 2
    ? ((data[data.length - 1].close - data[0].close) / data[0].close * 100).toFixed(2)
    : null;

  const volTop = margin.top + mainH + 4;
  const chartBottom = margin.top + mainH + volH + 4;
  const hoverCenterX = hoverIdx != null ? toX(hoverIdx) + candleGap / 2 : 0;
  const tooltipLeftPct = hoverIdx != null ? Math.min(Math.max((hoverCenterX / w) * 100, 0), 92) : 0;

  return (
    <div
      ref={containerRef}
      className="flex w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white"
      style={{ height }}
    >
      {/* 标题栏 */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2"
        style={{ height: HEADER_H }}
      >
        <h3 className="text-sm font-semibold">
          K线图 - {tsCode}
          {changePct != null && (
            <span className={`ml-2 text-xs ${Number(changePct) >= 0 ? 'text-red-500' : 'text-green-600'}`}>
              {Number(changePct) >= 0 ? '+' : ''}{changePct}%
            </span>
          )}
        </h3>
        <span className="text-xs text-gray-400">{data.length} 个交易日</span>
      </div>

      {/* K 线 + 成交量（独立绘图区） */}
      <div ref={plotWrapRef} className="relative min-h-0 shrink-0" style={{ height: plotH }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${w} ${plotH}`}
          preserveAspectRatio="none"
          className="block"
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {yTicks.map((tick, i) => (
            <g key={`grid-${i}`}>
              <line
                x1={margin.left}
                y1={toY(tick)}
                x2={margin.left + mainW}
                y2={toY(tick)}
                stroke={i === 0 ? '#d0d0d0' : '#e8e8e8'}
                strokeWidth={0.5}
              />
              <text x={margin.left - 6} y={toY(tick) + 4} textAnchor="end" fontSize={10} fill="#666">
                {tick.toFixed(2)}
              </text>
            </g>
          ))}

          <line
            x1={margin.left}
            y1={volTop}
            x2={margin.left + mainW}
            y2={volTop}
            stroke="#ccc"
            strokeWidth={0.5}
            strokeDasharray="2,2"
          />

          {xLabels.map((xl) => (
            <text
              key={xl.label}
              x={toX(xl.idx) + candleGap / 2}
              y={chartBottom + 12}
              textAnchor="middle"
              fontSize={10}
              fill="#666"
            >
              {xl.label}
            </text>
          ))}

          {data.map((d, i) => {
            const x = toX(i);
            const barW = Math.max(0.5, candleGap * 0.65);
            return (
              <rect
                key={`vol-${i}`}
                x={x + (candleGap - barW) / 2}
                y={toVolY(d.vol)}
                width={barW}
                height={Math.max(1, volTop + volH - toVolY(d.vol))}
                fill={volColor(isUp(d))}
              />
            );
          })}

          {data.map((d, i) => {
            const x = toX(i) + (candleGap - candleW) / 2;
            const centerX = toX(i) + candleGap / 2;
            const highY = toY(d.high);
            const lowY = toY(d.low);
            const openY = toY(d.open);
            const closeY = toY(d.close);
            const color = candleColor(isUp(d));
            const bodyTop = Math.min(openY, closeY);
            const bodyH = Math.max(1, Math.abs(closeY - openY));

            return (
              <g key={`candle-${i}`}>
                <line x1={centerX} y1={highY} x2={centerX} y2={lowY} stroke={color} strokeWidth={1} />
                <rect x={x} y={bodyTop} width={candleW} height={bodyH} fill={color} stroke={color} strokeWidth={0.5} />
              </g>
            );
          })}

          {hoverIdx != null && hoverD && (
            <>
              <line
                x1={hoverCenterX}
                y1={margin.top}
                x2={hoverCenterX}
                y2={chartBottom}
                stroke="#333"
                strokeWidth={0.5}
                strokeDasharray="3,3"
              />
              <line
                x1={margin.left}
                y1={toY(hoverD.close)}
                x2={margin.left + mainW}
                y2={toY(hoverD.close)}
                stroke="#333"
                strokeWidth={0.5}
                strokeDasharray="3,3"
              />
              <rect
                x={toX(hoverIdx)}
                y={margin.top}
                width={candleGap}
                height={chartBottom - margin.top}
                fill="rgba(0,0,0,0.04)"
              />
            </>
          )}
        </svg>

        {hoverD && (
          <div
            className="pointer-events-none absolute z-50 rounded border border-gray-300 bg-white px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${tooltipLeftPct}%`,
              top: 8,
              transform: 'translateX(8px)',
              maxWidth: 180,
            }}
          >
            <div className="mb-1 font-semibold">{fmtDate(hoverD.trade_date)}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <span className="text-gray-500">开盘:</span><span>{hoverD.open.toFixed(2)}</span>
              <span className="text-gray-500">最高:</span><span className="text-green-600">{hoverD.high.toFixed(2)}</span>
              <span className="text-gray-500">最低:</span><span className="text-red-500">{hoverD.low.toFixed(2)}</span>
              <span className="text-gray-500">收盘:</span><span>{hoverD.close.toFixed(2)}</span>
              <span className="text-gray-500">成交量:</span><span>{fmtYi(hoverD.vol)}</span>
            </div>
            <div className="mt-1 text-gray-400">
              {isUp(hoverD) ? (
                <span className="text-red-500">
                  +{(hoverD.close - hoverD.open).toFixed(2)} (+{((hoverD.close - hoverD.open) / hoverD.open * 100).toFixed(2)}%)
                </span>
              ) : (
                <span className="text-green-600">
                  {(hoverD.close - hoverD.open).toFixed(2)} ({((hoverD.close - hoverD.open) / hoverD.open * 100).toFixed(2)}%)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 时间选择（在 K 线/成交量下方） */}
      <div
        className="flex shrink-0 items-center gap-2 border-t border-gray-100 bg-gray-50 px-3 py-1.5"
        style={{ height: CONTROL_H }}
      >
        <span className="shrink-0 text-[11px] text-gray-500">时间:</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => handlePreset(p.months)}
            className="shrink-0 rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 hover:text-gray-800"
          >
            {p.label}
          </button>
        ))}
        <input
          type="text"
          value={rangeStart ? fmtDate(rangeStart) : ''}
          onChange={(e) => {
            let raw = e.target.value.replace(/\D/g, '');
            if (raw.length === 6) raw = '20' + raw;
            if (raw.length === 8 && /^\d{8}$/.test(raw)) setRangeStart(raw);
          }}
          placeholder="起始"
          className="w-[72px] shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-center text-[11px]"
        />
        <span className="text-[11px] text-gray-400">—</span>
        <input
          type="text"
          value={rangeEnd ? fmtDate(rangeEnd) : ''}
          onChange={(e) => {
            let raw = e.target.value.replace(/\D/g, '');
            if (raw.length === 6) raw = '20' + raw;
            if (raw.length === 8 && /^\d{8}$/.test(raw)) setRangeEnd(raw);
          }}
          placeholder="结束"
          className="w-[72px] shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-center text-[11px]"
        />
      </div>

      {/* 范围滑轨 */}
      <div
        ref={sliderRef}
        className="relative flex shrink-0 select-none items-center rounded-b-lg border-t border-gray-100 bg-gray-50 px-3"
        style={{ height: SLIDER_H, marginLeft: margin.left, marginRight: margin.right }}
      >
        <div className="absolute left-3 right-3 h-1.5 rounded-full bg-gray-200" />
        <div
          className="absolute h-1.5 rounded-full bg-blue-400"
          style={{
            left: `calc(${sliderToPct(sliderStartIdx)}% + 12px)`,
            width: `calc(${sliderToPct(sliderEndIdx) - sliderToPct(sliderStartIdx)}%)`,
          }}
        />
        <div
          className="absolute z-10 h-5 w-3 cursor-ew-resize rounded-sm border-2 border-blue-500 bg-white shadow hover:border-blue-600"
          style={{ left: `calc(${sliderToPct(sliderStartIdx)}% + 12px - 6px)` }}
          onMouseDown={onSliderMouseDown('start')}
        />
        <div
          className="absolute z-10 h-5 w-3 cursor-ew-resize rounded-sm border-2 border-blue-500 bg-white shadow hover:border-blue-600"
          style={{ left: `calc(${sliderToPct(sliderEndIdx)}% + 12px - 6px)` }}
          onMouseDown={onSliderMouseDown('end')}
        />
        <span className="absolute bottom-0.5 left-0 text-[10px] text-gray-400">{rangeStart ? fmtDate(rangeStart) : ''}</span>
        <span className="absolute bottom-0.5 right-0 text-[10px] text-gray-400">{rangeEnd ? fmtDate(rangeEnd) : ''}</span>
      </div>
    </div>
  );
}
