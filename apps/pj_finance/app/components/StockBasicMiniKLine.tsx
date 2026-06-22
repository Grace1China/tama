'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';

export type KlineBar = {
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 成交量（手） */
  vol: number;
  /** 换手率（%） */
  turnover_rate?: number | null;
};

/** 成交量：手 → 万手 */
function fmtVolWan(vol: number): string {
  if (!Number.isFinite(vol)) return '—';
  return `${(vol / 10000).toFixed(2)}万手`;
}

/** YYYYMMDD → YYYY/MM/DD */
function fullDate(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd;
  return `${ymd.slice(0, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
}

/** X 轴：YYYY/MM */
function axisDate(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd;
  return `${ymd.slice(0, 4)}/${ymd.slice(4, 6)}`;
}

/** 基本信息列内嵌：K 线 + 成交量经典组合（无控件，占满父级高度） */
export const StockBasicMiniKLine = memo(function StockBasicMiniKLine({
  data,
  className = '',
}: {
  data: KlineBar[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 280, h: 120 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const height = dims.h;
  const width = dims.w;
  const volH = Math.round(height * 0.24);
  const klineH = height - volH;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setDims({
          w: Math.max(80, e.contentRect.width),
          h: Math.max(60, e.contentRect.height),
        });
      }
    });
    ro.observe(el);
    setDims({ w: Math.max(80, el.clientWidth), h: Math.max(60, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2 || width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const pad = { top: 4, right: 4, bottom: 14, left: 38 };
    const plotW = width - pad.left - pad.right;
    const priceH = klineH - pad.top - 4;
    const volTop = klineH + 2;
    const volPlotH = volH - 4;

    let priceMin = Infinity;
    let priceMax = -Infinity;
    let volMax = 0;
    for (const d of data) {
      if (d.low < priceMin) priceMin = d.low;
      if (d.high > priceMax) priceMax = d.high;
      if (d.vol > volMax) volMax = d.vol;
    }
    const pricePad = (priceMax - priceMin) * 0.06 || 0.1;
    priceMin -= pricePad;
    priceMax += pricePad;
    const priceRange = priceMax - priceMin || 1;
    volMax = volMax || 1;

    const yPrice = (v: number) => pad.top + priceH * (1 - (v - priceMin) / priceRange);
    const yVol = (v: number) => volTop + volPlotH * (1 - v / volMax);

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, klineH);
    ctx.lineTo(width - pad.right, klineH);
    ctx.stroke();

    const candleW = Math.max(1, Math.min(6, plotW / data.length - 0.5));
    const gap = (plotW - candleW * data.length) / (data.length + 1);
    const centers: number[] = [];

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const cx = pad.left + gap + i * (candleW + gap) + candleW / 2;
      centers.push(cx);
      const up = d.close >= d.open;
      const color = up ? '#dc2626' : '#16a34a';

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yPrice(d.high));
      ctx.lineTo(cx, yPrice(d.low));
      ctx.stroke();
      const bodyTop = yPrice(Math.max(d.open, d.close));
      const bodyBot = yPrice(Math.min(d.open, d.close));
      ctx.fillRect(cx - candleW / 2, bodyTop, candleW, Math.max(1, bodyBot - bodyTop));

      const barW = Math.max(0.5, candleW * 0.85);
      const volY = yVol(d.vol);
      ctx.globalAlpha = 0.55;
      ctx.fillRect(cx - barW / 2, volY, barW, volTop + volPlotH - volY);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(priceMax.toFixed(2), pad.left - 2, pad.top + 8);
    ctx.fillText(priceMin.toFixed(2), pad.left - 2, pad.top + priceH);

    ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor(data.length / 4));
    for (let i = 0; i < data.length; i += step) {
      const x = pad.left + gap + i * (candleW + gap) + candleW / 2;
      ctx.fillText(axisDate(data[i].trade_date), x, height - 3);
    }

    (canvas as HTMLCanvasElement & { _centers?: number[] })._centers = centers;
  }, [data, width, height, klineH, volH]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const centers: number[] = (canvas as HTMLCanvasElement & { _centers?: number[] })._centers ?? [];
    if (!centers.length) return;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const dist = Math.abs(mx - centers[i]);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setHoverIdx(best);
  }, []);

  if (data.length < 2) {
    return (
      <div
        ref={containerRef}
        className={`flex h-full w-full items-center justify-center rounded border border-gray-100 bg-gray-50 text-[10px] text-gray-400 ${className}`}
      >
        暂无K线
      </div>
    );
  }

  const hover = hoverIdx != null ? data[hoverIdx] : null;

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full rounded border border-gray-100 bg-white ${className}`}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      />
      {hover && (
        <div className="pointer-events-none absolute left-1 top-1 z-10 max-w-[95%] rounded border border-gray-200 bg-white/95 px-1.5 py-0.5 text-[9px] leading-snug text-gray-700 shadow-sm">
          <span>{fullDate(hover.trade_date)} </span>
          <span>收{hover.close.toFixed(2)} </span>
          <span className={hover.close >= hover.open ? 'text-red-600' : 'text-green-600'}>
            {(((hover.close - hover.open) / hover.open) * 100).toFixed(2)}%
          </span>
          <span> 成交量{fmtVolWan(hover.vol)}</span>
          {hover.turnover_rate != null && Number.isFinite(hover.turnover_rate) ? (
            <span> 换手{hover.turnover_rate.toFixed(2)}%</span>
          ) : null}
        </div>
      )}
    </div>
  );
});
