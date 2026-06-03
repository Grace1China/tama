'use client';

import { useState, useEffect, useRef } from 'react';

interface SparkLineProps {
  tsCode: string;
  width?: number;
  height?: number;
}

interface CachedData {
  prices: number[];
  firstPrice: number;
  lastPrice: number;
}

// 全局缓存：避免重复请求
const cache = new Map<string, CachedData>();

export default function SparkLine({ tsCode, width = 150, height = 48 }: SparkLineProps) {
  const [data, setData] = useState<CachedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!tsCode) return;

    const cached = cache.get(tsCode);
    if (cached) {
      setData(cached);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    const fetchData = async () => {
      try {
        const url = `/api/parq/bfqDir?ts_code=${encodeURIComponent(tsCode)}&page=1&size=10000&sortField=trade_date&sortDir=asc`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) throw new Error(json.message);
        if (cancelled) return;

        const rows = (json.data || []) as any[];
        const prices: number[] = [];
        for (const r of rows) {
          if (r.close != null) prices.push(Number(r.close));
        }

        if (prices.length === 0) {
          if (mountedRef.current) { setData(null); setLoading(false); }
          return;
        }

        const result: CachedData = {
          prices,
          firstPrice: prices[0],
          lastPrice: prices[prices.length - 1],
        };
        cache.set(tsCode, result);
        if (mountedRef.current) setData(result);
      } catch {
        if (mountedRef.current) setError(true);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [tsCode]);

  if (loading) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center">
        <div className="w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return <div style={{ width, height }} className="flex items-center justify-center text-[10px] text-gray-300">—</div>;
  }

  const { prices, firstPrice, lastPrice } = data;
  const isUp = lastPrice >= firstPrice;
  const color = isUp ? '#ef5350' : '#26a69a'; // 国内红涨绿跌

  if (prices.length < 2) {
    return <div style={{ width, height }} className="flex items-center justify-center text-[10px] text-gray-300">—</div>;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pad = range * 0.05;
  const yMin = min - pad;
  const yRange = range + pad * 2;
  const toX = (i: number) => (i / (prices.length - 1)) * (width - 2) + 1;
  const toY = (v: number) => height - ((v - yMin) / yRange) * (height - 2) - 1;

  const points = prices.map((p, i) => `${toX(i)},${toY(p)}`).join(' ');

  const pctChg = ((lastPrice - firstPrice) / firstPrice * 100);

  return (
    <div className="flex items-center gap-2" style={{ width }}>
      <svg width={width} height={height} className="shrink-0">
        {/* 填充区域 */}
        <polygon
          points={`${toX(0)},${height} ${points} ${toX(prices.length - 1)},${height}`}
          fill={color}
          fillOpacity={0.1}
        />
        {/* 折线 */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="text-[11px] font-medium shrink-0"
        style={{ color: pctChg >= 0 ? '#ef5350' : '#26a69a' }}
      >
        {pctChg >= 0 ? '+' : ''}{pctChg.toFixed(1)}%
      </span>
    </div>
  );
}
