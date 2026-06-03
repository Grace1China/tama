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
  const [fullData, setFullData] = useState<OHLCData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [chartDims, setChartDims] = useState({ w: 800, h: height });

  // 日期范围（YYYYMMDD 字符串）
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  // 拉取全量数据
  useEffect(() => {
    if (!tsCode) { setFullData([]); setRangeStart(''); setRangeEnd(''); return; }
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/parq/bfqDir?ts_code=${encodeURIComponent(tsCode)}&page=1&size=1000000&sortField=trade_date&sortDir=asc&start_date=20140101`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || '请求失败');
        if (cancelled) return;
        const rows: OHLCData[] = (json.data || []).filter(
          (r: any) => r.open != null && r.high != null && r.low != null && r.close != null
        );
        setFullData(rows);
        // 默认显示全部
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

  // 按日期范围过滤
  const data = useMemo(() => {
    if (!rangeStart && !rangeEnd) return fullData;
    return fullData.filter((d) => {
      const date = String(d.trade_date);
      if (rangeStart && date < rangeStart) return false;
      if (rangeEnd && date > rangeEnd) return false;
      return true;
    });
  }, [fullData, rangeStart, rangeEnd]);

  // 响应容器尺寸
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setChartDims({ w: e.contentRect.width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // 价格范围
  const priceRange = useMemo(() => {
    if (!data.length) return { min: 0, max: 100, range: 100 };
    let min = Infinity, max = -Infinity;
    for (const d of data) {
      if (d.low < min) min = d.low;
      if (d.high > max) max = d.high;
    }
    const pad = (max - min) * 0.06 || 1;
    return { min: min - pad, max: max + pad, range: max - min + pad * 2 };
  }, [data]);

  // 成交量范围
  const volMax = useMemo(() => {
    if (!data.length) return 1;
    let m = 0;
    for (const d of data) if (d.vol > m) m = d.vol;
    return m || 1;
  }, [data]);

  const { w, h } = chartDims;
  const margin = { top: 10, right: 50, bottom: 30, left: 55 };
  const barH = 30;   // 日期控制栏高度
  const sliderH = 28; // 范围滑轨高度
  const volH = Math.round((h - barH - sliderH) * 0.18);
  const mainH = h - barH - margin.top - margin.bottom - volH - 6;
  const mainW = w - margin.left - margin.right;
  const chartH = mainH + volH + 6;

  const toX = useCallback((i: number) => margin.left + (i / Math.max(data.length - 1, 1)) * mainW, [margin.left, mainW, data.length]);
  const toY = useCallback((price: number) => margin.top + (1 - (price - priceRange.min) / priceRange.range) * mainH, [margin.top, mainH, priceRange]);
  const toVolY = useCallback((v: number) => margin.top + mainH + 6 + (1 - v / volMax) * volH, [margin.top, mainH, volMax, volH]);

  const candleW = useMemo(() => Math.max(1, Math.min(12, mainW / Math.max(data.length, 1) * 0.65)), [mainW, data.length]);
  const candleGap = useMemo(() => mainW / Math.max(data.length, 1), [mainW, data.length]);

  // Y 轴刻度
  const yTicks = useMemo(() => {
    const n = 5;
    const ticks: number[] = [];
    for (let i = 0; i <= n; i++) {
      ticks.push(priceRange.min + (priceRange.range * i) / n);
    }
    return ticks;
  }, [priceRange]);

  // X 轴标签
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

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const cx = toX(i) + candleGap / 2;
      const d = Math.abs(mx - cx);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    setHoverIdx(bestIdx);
  }, [data, toX, candleGap]);

  // 日期控制
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

  // 滑轨坐标计算（基于 fullData 全量日期范围）
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
  const sliderFromPct = useCallback((pct: number) => Math.round((pct / 100) * Math.max(sliderLen - 1, 0)), [sliderLen]);

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
      <div className="w-full flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50" style={{ height }}>
        <p className="text-gray-500">请选择股票代码查看 K 线</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50" style={{ height }}>
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full flex items-center justify-center border border-red-200 rounded-lg bg-red-50" style={{ height }}>
        <p className="text-red-500">错误: {error}</p>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="w-full flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50" style={{ height }}>
        <p className="text-gray-500">暂无数据</p>
      </div>
    );
  }

  const hoverD = hoverIdx != null ? data[hoverIdx] : null;
  const isGreen = (d: OHLCData) => d.close >= d.open;
  const changePct = data.length >= 2
    ? ((data[data.length - 1].close - data[0].close) / data[0].close * 100).toFixed(2)
    : null;
  const totalH = h;

  return (
    <div ref={containerRef} className="w-full border border-gray-200 rounded-lg bg-white relative" style={{ height: totalH }}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <h3 className="text-sm font-semibold">
          K线图 - {tsCode}
          {changePct != null && (
            <span className={`ml-2 text-xs ${Number(changePct) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {Number(changePct) >= 0 ? '+' : ''}{changePct}%
            </span>
          )}
        </h3>
        <span className="text-xs text-gray-400">{data.length} 个交易日</span>
      </div>

      {/* SVG 图表 */}
      <svg
        width="100%"
        height={totalH - 34 - barH - sliderH}
        viewBox={`0 0 ${w} ${totalH - 34 - barH - sliderH}`}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* 网格线 */}
        {yTicks.map((tick, i) => (
          <g key={`grid-${i}`}>
            <line
              x1={margin.left} y1={toY(tick)}
              x2={margin.left + mainW} y2={toY(tick)}
              stroke={i === 0 ? '#d0d0d0' : '#e8e8e8'} strokeWidth={0.5}
            />
            <text x={margin.left - 6} y={toY(tick) + 4} textAnchor="end" fontSize={10} fill="#666">
              {tick.toFixed(2)}
            </text>
          </g>
        ))}

        {/* 成交量虚线 */}
        <line x1={margin.left} y1={margin.top + mainH + 3} x2={margin.left + mainW} y2={margin.top + mainH + 3} stroke="#ccc" strokeWidth={0.5} strokeDasharray="2,2" />

        {/* X 轴年份标签 */}
        {xLabels.map((xl) => (
          <text
            key={xl.label}
            x={toX(xl.idx) + candleGap / 2}
            y={margin.top + chartH + 16}
            textAnchor="middle"
            fontSize={10}
            fill="#666"
          >
            {xl.label}
          </text>
        ))}

        {/* 成交量柱 */}
        {data.map((d, i) => {
          const x = toX(i);
          const barW = Math.max(0.5, candleGap * 0.65);
          return (
            <rect
              key={`vol-${i}`}
              x={x + (candleGap - barW) / 2}
              y={toVolY(d.vol)}
              width={barW}
              height={Math.max(1, volH - (toVolY(d.vol) - margin.top - mainH - 6))}
              fill={isGreen(d) ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)'}
            />
          );
        })}

        {/* K 线柱 */}
        {data.map((d, i) => {
          const x = toX(i) + (candleGap - candleW) / 2;
          const centerX = toX(i) + candleGap / 2;
          const highY = toY(d.high);
          const lowY = toY(d.low);
          const openY = toY(d.open);
          const closeY = toY(d.close);
          const green = isGreen(d);
          const color = green ? '#26a69a' : '#ef5350';
          const bodyTop = Math.min(openY, closeY);
          const bodyH = Math.max(1, Math.abs(closeY - openY));

          return (
            <g key={`candle-${i}`}>
              <line x1={centerX} y1={highY} x2={centerX} y2={lowY} stroke={color} strokeWidth={1} />
              <rect
                x={x}
                y={bodyTop}
                width={candleW}
                height={bodyH}
                fill={color}
                stroke={color}
                strokeWidth={0.5}
              />
            </g>
          );
        })}

        {/* 十字光标 */}
        {hoverIdx != null && hoverD && (
          <>
            <line
              x1={toX(hoverIdx) + candleGap / 2} y1={margin.top}
              x2={toX(hoverIdx) + candleGap / 2} y2={margin.top + chartH}
              stroke="#333" strokeWidth={0.5} strokeDasharray="3,3"
            />
            <line
              x1={margin.left} y1={toY(hoverD.close)}
              x2={margin.left + mainW} y2={toY(hoverD.close)}
              stroke="#333" strokeWidth={0.5} strokeDasharray="3,3"
            />
            <rect
              x={toX(hoverIdx)}
              y={margin.top}
              width={candleGap}
              height={chartH}
              fill="rgba(0,0,0,0.04)"
            />
          </>
        )}
      </svg>

      {/* 浮动提示 */}
      {hoverD && (
        <div
          className="absolute z-50 bg-white border border-gray-300 rounded shadow-lg px-3 py-2 text-xs"
          style={{
            left: Math.min(toX(hoverIdx!) + candleGap + 10, w - 180),
            top: 40,
            pointerEvents: 'none',
          }}
        >
          <div className="font-semibold mb-1">{fmtDate(hoverD.trade_date)}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-gray-500">开盘:</span><span>{hoverD.open.toFixed(2)}</span>
            <span className="text-gray-500">最高:</span><span className="text-green-600">{hoverD.high.toFixed(2)}</span>
            <span className="text-gray-500">最低:</span><span className="text-red-500">{hoverD.low.toFixed(2)}</span>
            <span className="text-gray-500">收盘:</span><span>{hoverD.close.toFixed(2)}</span>
            <span className="text-gray-500">成交量:</span><span>{fmtYi(hoverD.vol)}</span>
          </div>
          <div className="mt-1 text-gray-400">
            {isGreen(hoverD)
              ? <span className="text-green-600">+{(hoverD.close - hoverD.open).toFixed(2)} (+{((hoverD.close - hoverD.open) / hoverD.open * 100).toFixed(2)}%)</span>
              : <span className="text-red-500">{(hoverD.close - hoverD.open).toFixed(2)} ({((hoverD.close - hoverD.open) / hoverD.open * 100).toFixed(2)}%)</span>
            }
          </div>
        </div>
      )}

      {/* 日期范围控制栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-100 bg-gray-50" style={{ height: barH }}>
        <span className="text-[11px] text-gray-500 shrink-0">时间:</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => handlePreset(p.months)}
            className="text-[11px] px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-800 shrink-0"
          >
            {p.label}
          </button>
        ))}
        <input
          type="text"
          value={rangeStart ? fmtDate(rangeStart) : ''}
          onChange={(e) => {
            let raw = e.target.value.replace(/\D/g, '');
            if (raw.length === 6) raw = '20' + raw; // YYMMDD → YYYYMMDD
            if (raw.length === 8 && /^\d{8}$/.test(raw)) setRangeStart(raw);
          }}
          placeholder="起始"
          className="text-[11px] w-[72px] px-1.5 py-0.5 border border-gray-300 rounded shrink-0 text-center"
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
          className="text-[11px] w-[72px] px-1.5 py-0.5 border border-gray-300 rounded shrink-0 text-center"
        />
      </div>

      {/* 范围滑轨 */}
      <div
        ref={sliderRef}
        className="relative flex items-center px-3 border-t border-gray-100 bg-gray-50 select-none rounded-b-lg"
        style={{ height: sliderH, marginLeft: margin.left, marginRight: margin.right }}
      >
        {/* 轨道 */}
        <div className="absolute left-3 right-3 h-1.5 bg-gray-200 rounded-full" />
        {/* 选中范围 */}
        <div
          className="absolute h-1.5 bg-blue-400 rounded-full"
          style={{ left: `calc(${sliderToPct(sliderStartIdx)}% + 12px)`, width: `calc(${sliderToPct(sliderEndIdx) - sliderToPct(sliderStartIdx)}%)` }}
        />
        {/* 左滑块 */}
        <div
          className="absolute w-3 h-5 bg-white border-2 border-blue-500 rounded-sm cursor-ew-resize shadow hover:border-blue-600 z-10"
          style={{ left: `calc(${sliderToPct(sliderStartIdx)}% + 12px - 6px)` }}
          onMouseDown={onSliderMouseDown('start')}
        />
        {/* 右滑块 */}
        <div
          className="absolute w-3 h-5 bg-white border-2 border-blue-500 rounded-sm cursor-ew-resize shadow hover:border-blue-600 z-10"
          style={{ left: `calc(${sliderToPct(sliderEndIdx)}% + 12px - 6px)` }}
          onMouseDown={onSliderMouseDown('end')}
        />
        {/* 起止标签 */}
        <span className="absolute text-[10px] text-gray-400" style={{ left: 0, bottom: 2 }}>{rangeStart ? fmtDate(rangeStart) : ''}</span>
        <span className="absolute text-[10px] text-gray-400" style={{ right: 0, bottom: 2 }}>{rangeEnd ? fmtDate(rangeEnd) : ''}</span>
      </div>
    </div>
  );
}
