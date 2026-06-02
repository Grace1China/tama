'use client';

import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals } from 'reactflow';
import { CninfoStockRecentInfoModal } from '../components/CninfoStockRecentInfoModal';
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
  cardDetailVariant?: 'default' | 'tao' | 'sc_quantum' | 'commercial_space';
  /** 父泳道在流坐标下的宽高；用于裁剪卡片（RF 父子在 DOM 为兄弟节点） */
  laneClip: { w: number; h: number };
  /** 卡片流坐标宽度（px）；随公司卡片 zoom 在屏幕上放大缩小 */
  cardWidthScreen?: number;
}

/** 韬产业链详情字段（确定性已移至标题行） */
const TAO_DETAIL_FIELDS = ['入选说明', '产业作用'] as const;

/** 超导量子计算产业链详情字段（确定性、弹性已移至标题行） */
const SC_QUANTUM_DETAIL_FIELDS = ['路线', '产业位置'] as const;

/** 商业航天链详情字段（确定性、弹性已移至标题行） */
const COMMERCIAL_SPACE_DETAIL_FIELDS = ['路线', '产业位置', '理由', '风险'] as const;

/** 详情中多条目以 span  inline 展示的字段 */
const DETAIL_INLINE_MULTI_FIELDS = new Set<string>(['理由', '风险']);

/** 标题行展示的等级标签字段 */
const HEADER_LEVEL_FIELDS: Record<'tao' | 'sc_quantum' | 'commercial_space', readonly string[]> = {
  tao: ['确定性', '弹性'],
  sc_quantum: ['确定性', '弹性'],
  commercial_space: ['确定性', '弹性'],
};

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
  const [cninfoOpen, setCninfoOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const [detailMaxH, setDetailMaxH] = useState(0);
  const closeCninfo = useCallback(() => setCninfoOpen(false), []);
  const toggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setExpanded((v) => !v);
  }, []);
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
  }, [id, companyCardZoom, rx, ry, cardWidthFlow, expanded, updateNodeInternals]);

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
    data.cardDetailVariant === 'tao' ||
    data.cardDetailVariant === 'sc_quantum' ||
    data.cardDetailVariant === 'commercial_space'
      ? HEADER_LEVEL_FIELDS[data.cardDetailVariant]
          .map((field) => ({ field, val: data.companyInfo?.[field]?.trim() }))
          .filter((item): item is { field: string; val: string } => Boolean(item.val))
      : [];

  const curatedDetailFields =
    data.cardDetailVariant === 'commercial_space'
      ? COMMERCIAL_SPACE_DETAIL_FIELDS
      : data.cardDetailVariant === 'sc_quantum'
        ? SC_QUANTUM_DETAIL_FIELDS
        : data.cardDetailVariant === 'tao'
          ? TAO_DETAIL_FIELDS
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
    if (!expanded || !headerRef.current) {
      setDetailMaxH(0);
      return;
    }
    const headerH = headerRef.current.offsetHeight;
    const chrome = px(12) * 2 + px(2) * 2 + px(8);
    setDetailMaxH(Math.max(px(48), clipH - headerH - chrome));
  }, [expanded, clipH, z, data.label, headerLevelValues.length, curatedDetailFields]);

  /** React Flow panOnScroll 会吞掉滚轮；在 capture 阶段手动滚动详情区 */
  useEffect(() => {
    const el = detailScrollRef.current;
    if (!expanded || !el || detailMaxH <= 0) return undefined;

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
  }, [expanded, detailMaxH]);

  const nameStyle = {
    fontSize: `${px(16)}px`,
    fontWeight: 'bold' as const,
    fontFamily: 'inherit',
  };

  return (
    <div
      style={{
        maxWidth: clipW,
        maxHeight: clipH,
        overflow: 'hidden',
        margin: 0,
        padding: 0,
        cursor: 'grab',
        display: 'flex',
        flexDirection: 'column',
      }}
      className="active:cursor-grabbing"
    >
      <div
        style={{
          padding: `${px(12)}px`,
          borderRadius: `${px(8)}px`,
          background: '#ffffff',
          border: `${px(2)}px solid #e5e7eb`,
          borderLeft: `${px(4)}px solid ${layerAccent}`,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          width: `${cardWidthFlow}px`,
          maxHeight: expanded ? clipH : undefined,
          fontFamily: 'sans-serif',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Handle id="top" type="target" position={Position.Top} style={handleStyle} />
        <Handle id="bottom" type="source" position={Position.Bottom} style={handleStyle} />
        <Handle id="left-in" type="target" position={Position.Left} style={{ ...handleStyle, top: '32%' }} />
        <Handle id="left-out" type="source" position={Position.Left} style={{ ...handleStyle, top: '68%' }} />
        <Handle id="right-in" type="target" position={Position.Right} style={{ ...handleStyle, top: '32%' }} />
        <Handle id="right-out" type="source" position={Position.Right} style={{ ...handleStyle, top: '68%' }} />

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
                    setCninfoOpen(true);
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
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={toggleExpanded}
              title={expanded ? '收起详情' : '展开详情'}
              aria-expanded={expanded}
              style={{
                flexShrink: 0,
                margin: 0,
                padding: `${px(2)}px ${px(6)}px`,
                border: `${px(1)}px solid #e5e7eb`,
                borderRadius: `${px(4)}px`,
                background: expanded ? '#f3f4f6' : '#ffffff',
                cursor: 'pointer',
                fontSize: `${px(10)}px`,
                color: '#6b7280',
                lineHeight: 1.2,
                fontFamily: 'inherit',
              }}
            >
              {expanded ? '收起' : '详情'}
            </button>
          </div>
        </div>

        {expanded ? (
          <div
            ref={detailScrollRef}
            className="nodrag"
            style={{
              maxHeight: detailMaxH > 0 ? detailMaxH : undefined,
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
            {curatedDetailFields ? (
              curatedDetailFields.map((key) => {
                const val = data.companyInfo?.[key]?.trim();
                if (!val) return null;
                return renderCuratedDetailField(key, val);
              })
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
      {data.tsCode ? (
        <CninfoStockRecentInfoModal open={cninfoOpen} tsCode={data.tsCode} onClose={closeCninfo} />
      ) : null}
    </div>
  );
};

export default memo(IndustryNode);
