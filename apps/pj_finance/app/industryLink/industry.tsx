'use client';

import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals } from 'reactflow';
import { StockDetailModal } from '../components/StockDetailModal';
import { useCompanyCardZoomScale } from './companyCardZoom';

// 1. 严格定义节点的数据结构，包含你关注的定性指标
export interface IndustryNodeData {
  label: string;
  category: 'Upstream' | 'Midstream' | 'Downstream';
  pricingPower: 'High' | 'Medium' | 'Low';
  competitiveAdvantage: string;
  valuationHint?: string; // 用于展示如「TTM PE: 25x」等定量映射
  /** 证券代码（Tushare 风格）；有值时公司名称可点，打开巨潮近期公告弹窗 */
  tsCode?: string;
  /** YAML info 块（韬产业链：入选说明、产业作用、确定性等） */
  companyInfo?: Record<string, string>;
  /** 详情区展示模式 */
  cardDetailVariant?: 'default' | 'taxonomy';
  /** 近期价格和交易日涨跌幅 */
  priceSnapshot?: {
    trade_date: string;
    close: number | null;
    returns: {
      d1: number | null;
      d5: number | null;
      d20: number | null;
      d60: number | null;
    };
  };
  /** 集合竞价实时/准实时快照 */
  auctionSnapshot?: {
    snapshot_at: string;
    received_at: string;
    last_price: number | null;
    pre_close: number | null;
    pct_chg: number | null;
    volume: number | null;
    amount: number | null;
    source: string;
    status: string;
  };
  /** 近年财务增长摘要 */
  financialGrowth?: {
    report_date: string;
    revenue_cagr: number | null;
    revenue_years: number | null;
    profit_cagr: number | null;
    profit_years: number | null;
  };
  /** 最新报告期财务质量摘要 */
  financialQuality?: {
    report_date: string;
    roe: number | null;
    leverage: number | null;
    gross_margin: number | null;
  };
  /** 父泳道在流坐标下的宽高；用于裁剪卡片（RF 父子在 DOM 为兄弟节点） */
  laneClip: { w: number; h: number };
  /** 卡片流坐标宽度（px）；随公司卡片 zoom 在屏幕上放大缩小 */
  cardWidthScreen?: number;
}

/** 详情中多条目以 span  inline 展示的字段 */
const DETAIL_INLINE_MULTI_FIELDS = new Set<string>(['理由', '风险', '国际可比公司']);

/** 标题行展示的等级标签字段 */
const HEADER_LEVEL_FIELDS = ['确定性', '弹性'] as const;

const DETAIL_SKIP_FIELDS = new Set<string>(['代码', 'ts_code', 'tsCode', ...HEADER_LEVEL_FIELDS]);

function formatPrice(v: number | null | undefined): string {
  return Number.isFinite(v) ? Number(v).toFixed(2) : '--';
}

function formatReturnPct(v: number | null | undefined): string {
  if (!Number.isFinite(v)) return '--';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function formatAmountYi(v: number | null | undefined): string {
  if (!Number.isFinite(v)) return '--';
  return `${(Number(v) / 100000000).toFixed(2)}亿`;
}

function returnColor(v: number | null | undefined): string {
  if (!Number.isFinite(v) || Math.abs(Number(v)) < 0.005) return '#6b7280';
  return Number(v) > 0 ? '#dc2626' : '#059669';
}

function formatCagrPct(v: number | null | undefined): string {
  if (!Number.isFinite(v)) return '--';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function formatPlainPct(v: number | null | undefined): string {
  if (!Number.isFinite(v)) return '--';
  return `${Number(v).toFixed(1)}%`;
}

function formatLeverage(v: number | null | undefined): string {
  if (!Number.isFinite(v)) return '--';
  return `${Number(v).toFixed(1)}x`;
}

function auctionStatusText(status: string | undefined): string {
  switch (status) {
    case 'strong_bid':
      return '强抢筹';
    case 'bid':
      return '抢筹';
    case 'strong_pressure':
      return '强承压';
    case 'pressure':
      return '承压';
    case 'flat':
      return '平稳';
    default:
      return '竞价';
  }
}

import { getLevelColor } from './levelColor';
// 2. 根据定价权动态设置 UI 颜色标签
const getPricingPowerColor = (power: string) => {
  switch (power) {
    case 'High': return '#ef4444'; // 红色高亮强定价权
    case 'Medium': return '#f59e0b';
    case 'Low': return '#10b981';
    default: return '#6b7280';
  }
};

// 3. 自定义节点组件；四角句柄便于互连。
// RF 带子 parentId 的子节点 DOM 仍为 .react-flow__nodes 下与父同行的 div，须在卡片外包一层按父泳道剩余矩形做 overflow 裁剪。
const IndustryNode = ({ id, data }: NodeProps<IndustryNodeData>) => {
  const { getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const companyCardZoom = useCompanyCardZoomScale();
  const [stockDetailOpen, setStockDetailOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [flowViewportRect, setFlowViewportRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [placeholderSize, setPlaceholderSize] = useState<{ w: number; h: number } | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const cardShellRef = useRef<HTMLDivElement>(null);
  const [detailMaxH, setDetailMaxH] = useState(0);
  const closeStockDetail = useCallback(() => setStockDetailOpen(false), []);
  const toggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setExpanded((v) => !v);
  }, []);
  const toggleMaximized = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setMaximized((prev) => {
      if (prev) {
        setFlowViewportRect(null);
        return false;
      }
      const cardRect = cardShellRef.current?.getBoundingClientRect();
      if (cardRect) {
        setPlaceholderSize({ w: cardRect.width, h: Math.max(cardRect.height, 48 * companyCardZoom) });
      }
      const rfEl = cardShellRef.current?.closest('.react-flow') as HTMLElement | null;
      if (rfEl) {
        const rect = rfEl.getBoundingClientRect();
        setFlowViewportRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      }
      setExpanded(true);
      return true;
    });
  }, [companyCardZoom]);

  /** 最大化时跟随 React Flow 视口尺寸变化 */
  useEffect(() => {
    if (!maximized) return undefined;

    const syncFlowViewportRect = () => {
      const rfEl = document.querySelector('.react-flow') as HTMLElement | null;
      if (!rfEl) return;
      const rect = rfEl.getBoundingClientRect();
      setFlowViewportRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    };

    syncFlowViewportRect();
    const rfEl = document.querySelector('.react-flow') as HTMLElement | null;
    const ro = rfEl ? new ResizeObserver(syncFlowViewportRect) : null;
    if (rfEl && ro) ro.observe(rfEl);
    window.addEventListener('resize', syncFlowViewportRect);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', syncFlowViewportRect);
    };
  }, [maximized]);
  const self = getNode(id);
  const rx = self?.position.x ?? 0;
  const ry = self?.position.y ?? 0;
  const lw = data.laneClip.w;
  const lh = data.laneClip.h;
  const clipW = Math.max(4, lw - rx);
  const clipH = Math.max(4, lh - ry);
  const z = companyCardZoom;
  const px = (n: number) => n * z;
  const cardWidthFlow = px(data.cardWidthScreen ?? 220);

  /** 缩放、拖移或折叠状态变化后刷新 Handle 坐标，使连线锚点跟随卡片 */
  useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [id, companyCardZoom, rx, ry, cardWidthFlow, expanded, maximized, updateNodeInternals]);

  const layerAccent =
    data.category === 'Upstream'
      ? '#059669'
      : data.category === 'Midstream'
        ? '#d97706'
        : '#2563eb';

  const handleStyle = {
    background: '#64748b',
    width: px(8),
    height: px(8),
  };

  const headerLevelValues =
    data.cardDetailVariant === 'taxonomy'
      ? HEADER_LEVEL_FIELDS
          .map((field) => ({ field, val: data.companyInfo?.[field]?.trim() }))
          .filter((item) => Boolean(item.val)) as { field: string; val: string }[]
      : [];

  const taxonomyDetailEntries =
    data.cardDetailVariant === 'taxonomy'
      ? Object.entries(data.companyInfo ?? {}).filter(([key, val]) => !DETAIL_SKIP_FIELDS.has(key) && val.trim())
      : null;

  const renderCuratedDetailField = (key: string, val: string) => {
    const items = DETAIL_INLINE_MULTI_FIELDS.has(key)
      ? val.split('\n').map((s) => s.trim()).filter(Boolean)
      : [];
    const valueColor = key === '风险' ? '#b45309' : '#111827';

    return (
      <div key={key} style={{ fontSize: `${px(12)}px`, lineHeight: 1.4 }}>
        <span style={{ color: '#4b5563' }}>{key}：</span>
        {items.length > 0 ? (
          items.map((item, i) => (
            <span
              key={`${key}-${i}`}
              style={{
                color: valueColor,
                marginLeft: i > 0 ? px(6) : 0,
              }}
            >
              {item}
            </span>
          ))
        ) : (
          <span style={{ color: valueColor }}>{val}</span>
        )}
      </div>
    );
  };

  useLayoutEffect(() => {
    if (!expanded || !headerRef.current || maximized) {
      if (!maximized) setDetailMaxH(0);
      return;
    }
    const headerH = headerRef.current.offsetHeight;
    const chrome = px(12) * 2 + px(2) * 2 + px(8);
    setDetailMaxH(Math.max(px(48), clipH - headerH - chrome));
  }, [expanded, maximized, clipH, z, data.label, headerLevelValues.length, taxonomyDetailEntries]);

  /** React Flow panOnScroll 会吞掉滚轮；在 capture 阶段手动滚动详情区 */
  useEffect(() => {
    const el = detailScrollRef.current;
    if (!expanded || !el) return undefined;
    if (!maximized && detailMaxH <= 0) return undefined;

    const onWheel = (e: WheelEvent) => {
      if (!el.contains(e.target as Node)) return;

      const { scrollHeight, clientHeight, scrollTop } = el;
      if (scrollHeight <= clientHeight + 1) return;

      const maxScroll = scrollHeight - clientHeight;
      const delta = e.deltaY;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop >= maxScroll - 1;

      if ((delta < 0 && atTop) || (delta > 0 && atBottom)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      el.scrollTop = Math.min(maxScroll, Math.max(0, scrollTop + delta));
    };

    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, [expanded, maximized, detailMaxH]);

  const nameStyle = {
    fontSize: `${px(16)}px`,
    fontWeight: 'bold' as const,
    fontFamily: 'inherit',
  };

  const priceSnapshot = data.priceSnapshot;
  const auctionSnapshot = data.auctionSnapshot;
  const financialGrowth = data.financialGrowth;
  const financialQuality = data.financialQuality;
  const priceChips = [
    { label: '现价', value: formatPrice(priceSnapshot?.close), color: '#111827' },
    { label: '今', value: formatReturnPct(priceSnapshot?.returns.d1), color: returnColor(priceSnapshot?.returns.d1) },
    { label: '5日', value: formatReturnPct(priceSnapshot?.returns.d5), color: returnColor(priceSnapshot?.returns.d5) },
    { label: '20日', value: formatReturnPct(priceSnapshot?.returns.d20), color: returnColor(priceSnapshot?.returns.d20) },
    { label: '60日', value: formatReturnPct(priceSnapshot?.returns.d60), color: returnColor(priceSnapshot?.returns.d60) },
  ];
  const auctionChips = [
    { label: '竞价', value: formatReturnPct(auctionSnapshot?.pct_chg), color: returnColor(auctionSnapshot?.pct_chg) },
    { label: '价', value: formatPrice(auctionSnapshot?.last_price), color: '#111827' },
    { label: '额', value: formatAmountYi(auctionSnapshot?.amount), color: '#111827' },
    { label: '态', value: auctionStatusText(auctionSnapshot?.status), color: returnColor(auctionSnapshot?.pct_chg) },
  ];
  const growthChips = [
    {
      label: financialGrowth?.revenue_years ? `营收${financialGrowth.revenue_years}Y` : '营收',
      value: formatCagrPct(financialGrowth?.revenue_cagr),
      color: returnColor(financialGrowth?.revenue_cagr),
    },
    {
      label: financialGrowth?.profit_years ? `利润${financialGrowth.profit_years}Y` : '利润',
      value: formatCagrPct(financialGrowth?.profit_cagr),
      color: returnColor(financialGrowth?.profit_cagr),
    },
  ];
  const qualityChips = [
    { label: 'ROE', value: formatPlainPct(financialQuality?.roe), color: '#111827' },
    { label: '杠杆', value: formatLeverage(financialQuality?.leverage), color: '#111827' },
    { label: '毛利', value: formatPlainPct(financialQuality?.gross_margin), color: '#111827' },
  ];

  const actionBtnStyle = {
    flexShrink: 0,
    margin: 0,
    padding: `${px(2)}px ${px(6)}px`,
    border: `${px(1)}px solid #e5e7eb`,
    borderRadius: `${px(4)}px`,
    background: '#ffffff',
    cursor: 'pointer',
    fontSize: `${px(10)}px`,
    color: '#6b7280',
    lineHeight: 1.2,
    fontFamily: 'inherit',
  } as const;

  const cardShell = (
    <div
      ref={cardShellRef}
      style={{
        padding: `${px(12)}px`,
        borderRadius: maximized ? 0 : `${px(8)}px`,
        background: '#ffffff',
        border: maximized ? 'none' : `${px(2)}px solid #e5e7eb`,
        borderLeft: maximized ? 'none' : `${px(4)}px solid ${layerAccent}`,
        boxShadow: maximized ? 'none' : '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        width: maximized ? '100%' : `${cardWidthFlow}px`,
        height: maximized ? '100%' : undefined,
        maxHeight: maximized ? '100%' : expanded ? clipH : undefined,
        fontFamily: 'sans-serif',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {!maximized ? (
        <>
          <Handle id="top" type="target" position={Position.Top} style={handleStyle} />
          <Handle id="bottom" type="source" position={Position.Bottom} style={handleStyle} />
          <Handle id="left-in" type="target" position={Position.Left} style={{ ...handleStyle, top: '32%' }} />
          <Handle id="left-out" type="source" position={Position.Left} style={{ ...handleStyle, top: '68%' }} />
          <Handle id="right-in" type="target" position={Position.Right} style={{ ...handleStyle, top: '32%' }} />
          <Handle id="right-out" type="source" position={Position.Right} style={{ ...handleStyle, top: '68%' }} />
        </>
      ) : null}

      {/* 永久展示：公司名称 */}
      <div ref={headerRef} style={{ flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: `${px(6)}px`,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              gap: `${px(6)}px`,
            }}
          >
            {data.tsCode ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setStockDetailOpen(true);
                }}
                style={{
                  margin: 0,
                  padding: 0,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  ...nameStyle,
                  color: '#2563eb',
                  textDecoration: 'underline',
                  textAlign: 'left',
                }}
              >
                {data.label}
              </button>
            ) : (
              <div style={{ ...nameStyle, color: '#111827' }}>{data.label}</div>
            )}
            {headerLevelValues.length > 0 ? (
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: `${px(6)}px` }}>
                {headerLevelValues.map(({ field, val }) => (
                  <span
                    key={field}
                    style={{
                      fontSize: `${px(13)}px`,
                      fontWeight: 'bold',
                      color: getLevelColor(val),
                      lineHeight: 1.2,
                    }}
                  >
                    {val}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
          <div style={{ display: 'flex', flexShrink: 0, gap: `${px(4)}px` }}>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={toggleExpanded}
              title={expanded ? '收起详情' : '展开详情'}
              aria-expanded={expanded}
              style={{
                ...actionBtnStyle,
                background: expanded ? '#f3f4f6' : '#ffffff',
              }}
            >
              {expanded ? '收起' : '详情'}
            </button>
            {maximized ? (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={toggleMaximized}
                title="最小化"
                style={{
                  ...actionBtnStyle,
                  background: '#f3f4f6',
                }}
              >
                最小化
              </button>
            ) : (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={toggleMaximized}
                title="最大化"
                style={actionBtnStyle}
              >
                最大化
              </button>
            )}
          </div>
        </div>
          {data.tsCode ? (
            <div
              title={financialQuality?.report_date ? `财务期：${financialQuality.report_date}；ROE为最新披露口径，杠杆为总资产/权益，毛利为毛利率` : undefined}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: `${px(4)}px`,
                marginTop: `${px(5)}px`,
                fontSize: `${px(10)}px`,
                lineHeight: 1.2,
              }}
            >
              {qualityChips.map((chip) => (
                <span
                  key={chip.label}
                  style={{
                    display: 'inline-flex',
                    gap: `${px(2)}px`,
                    alignItems: 'baseline',
                    border: `${px(1)}px solid #e5e7eb`,
                    borderRadius: `${px(4)}px`,
                    padding: `${px(1)}px ${px(4)}px`,
                    background: '#eef2ff',
                    color: '#6b7280',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{chip.label}</span>
                  <span style={{ color: chip.color, fontWeight: 700 }}>{chip.value}</span>
                </span>
              ))}
            </div>
          ) : null}
          {data.tsCode ? (
            <div
              title={financialGrowth?.report_date ? `财务期：${financialGrowth.report_date}，CAGR按最近可用年报向前回退计算` : undefined}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: `${px(4)}px`,
                marginTop: `${px(5)}px`,
                fontSize: `${px(10)}px`,
                lineHeight: 1.2,
              }}
            >
              {growthChips.map((chip) => (
                <span
                  key={chip.label}
                  style={{
                    display: 'inline-flex',
                    gap: `${px(2)}px`,
                    alignItems: 'baseline',
                    border: `${px(1)}px solid #e5e7eb`,
                    borderRadius: `${px(4)}px`,
                    padding: `${px(1)}px ${px(4)}px`,
                    background: '#fff7ed',
                    color: '#6b7280',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{chip.label}</span>
                  <span style={{ color: chip.color, fontWeight: 700 }}>{chip.value}</span>
                </span>
              ))}
            </div>
          ) : null}
          {data.tsCode ? (
            <div
              title={auctionSnapshot?.snapshot_at ? `集合竞价：${auctionSnapshot.snapshot_at}；数据源：${auctionSnapshot.source}` : '等待 MyQuant 集合竞价快照'}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: `${px(4)}px`,
                marginTop: `${px(6)}px`,
                fontSize: `${px(10)}px`,
                lineHeight: 1.2,
              }}
            >
              {auctionChips.map((chip) => (
                <span
                  key={chip.label}
                  style={{
                    display: 'inline-flex',
                    gap: `${px(2)}px`,
                    alignItems: 'baseline',
                    border: `${px(1)}px solid #fecaca`,
                    borderRadius: `${px(4)}px`,
                    padding: `${px(1)}px ${px(4)}px`,
                    background: '#fff1f2',
                    color: '#6b7280',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{chip.label}</span>
                  <span style={{ color: chip.color, fontWeight: 700 }}>{chip.value}</span>
                </span>
              ))}
            </div>
          ) : null}
          {data.tsCode ? (
            <div
              title={priceSnapshot?.trade_date ? `行情日期：${priceSnapshot.trade_date}` : undefined}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: `${px(4)}px`,
                marginTop: `${px(6)}px`,
                fontSize: `${px(10)}px`,
                lineHeight: 1.2,
              }}
            >
              {priceChips.map((chip) => (
                <span
                  key={chip.label}
                  style={{
                    display: 'inline-flex',
                    gap: `${px(2)}px`,
                    alignItems: 'baseline',
                    border: `${px(1)}px solid #e5e7eb`,
                    borderRadius: `${px(4)}px`,
                    padding: `${px(1)}px ${px(4)}px`,
                    background: '#f9fafb',
                    color: '#6b7280',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{chip.label}</span>
                  <span style={{ color: chip.color, fontWeight: 700 }}>{chip.value}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {expanded ? (
          <div
            ref={detailScrollRef}
            className="nodrag"
            style={{
              flex: maximized ? 1 : undefined,
              minHeight: maximized ? 0 : undefined,
              maxHeight: !maximized && detailMaxH > 0 ? detailMaxH : undefined,
              overflowY: 'auto',
              overflowX: 'hidden',
              borderTop: `${px(1)}px solid #e5e7eb`,
              marginTop: `${px(8)}px`,
              paddingTop: `${px(8)}px`,
              display: 'flex',
              flexDirection: 'column',
              gap: `${px(6)}px`,
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {taxonomyDetailEntries ? (
              taxonomyDetailEntries.map(([key, val]) => renderCuratedDetailField(key, val))
            ) : (
              <>
                <div
                  style={{
                    fontSize: `${px(12)}px`,
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ color: '#4b5563' }}>定价权：</span>
                  <span style={{ fontWeight: 'bold', color: getPricingPowerColor(data.pricingPower) }}>
                    {data.pricingPower}
                  </span>
                </div>

                <div style={{ fontSize: `${px(12)}px`, lineHeight: 1.4 }}>
                  <span style={{ color: '#4b5563' }}>竞争优势（护城河）：</span>
                  <span style={{ color: '#111827' }}>{data.competitiveAdvantage}</span>
                </div>

                {data.valuationHint ? (
                  <div
                    style={{
                      fontSize: `${px(11)}px`,
                      color: '#2563eb',
                      marginTop: `${px(4)}px`,
                      textAlign: 'right',
                    }}
                  >
                    {data.valuationHint}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
    </div>
  );

  return (
    <>
      <div
        style={
          maximized
            ? {
                width: placeholderSize?.w ?? cardWidthFlow,
                height: placeholderSize?.h ?? px(48),
                margin: 0,
                padding: 0,
                pointerEvents: 'none',
                opacity: 0,
              }
            : {
                maxWidth: clipW,
                maxHeight: clipH,
                overflow: 'hidden',
                margin: 0,
                padding: 0,
                cursor: 'grab',
                display: 'flex',
                flexDirection: 'column',
              }
        }
        className={maximized ? undefined : 'active:cursor-grabbing'}
      >
        {!maximized ? cardShell : null}
      </div>
      {maximized && flowViewportRect
        ? createPortal(
            <div
              className="nodrag nowheel"
              style={{
                position: 'fixed',
                top: flowViewportRect.top,
                left: flowViewportRect.left,
                width: flowViewportRect.width,
                height: flowViewportRect.height,
                zIndex: 99999,
                boxSizing: 'border-box',
              }}
            >
              {cardShell}
            </div>,
            document.body,
          )
        : null}
      {data.tsCode ? (
        <StockDetailModal
          open={stockDetailOpen}
          tsCode={data.tsCode}
          stockName={data.label}
          onClose={closeStockDetail}
        />
      ) : null}
    </>
  );
};

export default memo(IndustryNode);
