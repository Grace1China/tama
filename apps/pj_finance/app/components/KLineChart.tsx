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

/** 格式化 YYYYMMDD → YY/MM */
function fmtDate(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd;
  return `${ymd.slice(2, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
}

/** 格式化金额（万元 → 亿） */
function fmtYi(v: number): string {
  return (v / 10000).toFixed(2) + '亿';
}

export default function KLineChart({ tsCode, height = 420 }: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<OHLCData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [chartDims, setChartDims] = useState({ w: 800, h: height });

  // 拉取数据
  useEffect(() => {
    if (!tsCode) { setData([]); return; }
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
        setData(rows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '获取数据失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [tsCode]);

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
  const volH = Math.round(h * 0.18);
  const mainH = h - margin.top - margin.bottom - volH - 6;
  const mainW = w - margin.left - margin.right;
  const volW = mainW;
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

  // X 轴标签（每年一个）
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
    // 找到最近的 candle
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const cx = toX(i) + candleGap / 2;
      const d = Math.abs(mx - cx);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    setHoverIdx(bestIdx);
  }, [data, toX, candleGap]);

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

  return (
    <div ref={containerRef} className="w-full border border-gray-200 rounded-lg bg-white relative" style={{ height }}>
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
        height={h - 34}
        viewBox={`0 0 ${w} ${h - 34}`}
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
              {/* 影线 */}
              <line x1={centerX} y1={highY} x2={centerX} y2={lowY} stroke={color} strokeWidth={1} />
              {/* 实体 */}
              <rect
                x={x}
                y={bodyTop}
                width={candleW}
                height={bodyH}
                fill={green ? color : color}
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
            {/* 当日竖线高亮 */}
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
    </div>
  );
}
