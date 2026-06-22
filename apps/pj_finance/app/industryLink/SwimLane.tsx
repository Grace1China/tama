import React, { memo, useCallback } from 'react';
import type { NodeProps } from 'reactflow';
import { useStore } from 'reactflow';

import { getLevelColor } from './levelColor';
import { buildIncomeContrastUrl, type IncomeContrastCompanyContext } from './incomeContrastUrl';

/** 泳道父容器（React Flow parent）；须显式宽高；三层竖向拼接时 roundingMode 控制圆角与分割 */
export type SwimLaneNodeData = {
  title: string;
  /** 第一层根泳道名；与 title（子泳道）不同时展示 */
  groupTitle?: string;
  /** 子泳道级产业链说明（产业位置、确定性、弹性等） */
  subLaneInfo?: Record<string, string>;
  /** 层底部分割线（最下一层一般 false，避免与画布底重复） */
  dividerBottom?: boolean;
  roundingMode?: 'top' | 'mid' | 'bottom' | 'single';
  /** 子泳道公司列表（ts_code 优先），用于跳转利润对比 */
  compareStocks?: string[];
  /** 各公司确定性/弹性，与 compareStocks 对应 token */
  compareCompanyContexts?: IncomeContrastCompanyContext[];
};

/** inv = 1/zoom；圆角写在节点 CSS 中会随画布缩放放大，除以 zoom 后屏幕观感约恒定 */
function radiusFor(mode: SwimLaneNodeData['roundingMode'], inv: number): string {
  const r = (n: number) => `${n * inv}px`;
  if (mode === 'top') return `${r(14)} ${r(14)} 0 0`;
  if (mode === 'mid') return '0';
  if (mode === 'bottom') return `0 0 ${r(14)} ${r(14)}`;
  return r(14);
}

/** 期望在屏幕像素上保持稳定的上/左留白（画布 zoom 时在节点坐标里按比例除以 zoom） */
const PAD_TOP_SCREEN_PX = 10;
const PAD_LEFT_SCREEN_PX = 16;
/** 与标题区其余边留白，同理由保持屏幕像素近似恒定 */
const PAD_RIGHT_SCREEN_PX = 16;
const PAD_BOTTOM_SCREEN_PX = 10;

function SwimLaneNode({ data }: NodeProps<SwimLaneNodeData>) {
  /** zoom 取自视口矩阵 [x,y,zoom]；节点身处在缩放层内，故用 1/zoom 换算 padding/文字反缩放 */
  const zoom = useStore((s) => s.transform[2]);
  const inv = zoom > 0 ? 1 / zoom : 1;
  const rm = data.roundingMode ?? 'single';
  const pt = PAD_TOP_SCREEN_PX * inv;
  const pr = PAD_RIGHT_SCREEN_PX * inv;
  const pb = PAD_BOTTOM_SCREEN_PX * inv;
  const pl = PAD_LEFT_SCREEN_PX * inv;

  const lanePos = data.subLaneInfo?.产业位置?.trim();
  const certainty = data.subLaneInfo?.确定性?.trim();
  const elasticity = data.subLaneInfo?.弹性?.trim();
  const elasticityFactors = data.subLaneInfo?.弹性因子
    ?.split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const compareStocks = data.compareStocks ?? [];
  const canOpenCompare = compareStocks.length > 0;

  const openIncomeContrast = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!canOpenCompare) return;
      const url = buildIncomeContrastUrl(compareStocks, {
        lane: data.title,
        subCertainty: data.subLaneInfo?.确定性?.trim(),
        subElasticity: data.subLaneInfo?.弹性?.trim(),
        companyContexts: data.compareCompanyContexts,
      });
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [canOpenCompare, compareStocks, data.title, data.subLaneInfo, data.compareCompanyContexts],
  );

  return (
    <div
      style={{
        pointerEvents: 'none',
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
        borderRadius: radiusFor(rm, inv),
        border: 'none',
        borderBottom: data.dividerBottom
          ? `${2 * inv}px solid rgba(51, 65, 85, 0.88)`
          : 'none',
        background: 'linear-gradient(165deg, rgba(248,250,252,0.92) 0%, rgba(226,232,240,0.5) 100%)',
        boxShadow: rm === 'top' ? 'inset 0 1px 0 rgba(255,255,255,0.55)' : 'none',
        padding: `${pt}px ${pr}px ${pb}px ${pl}px`,
      }}
      className="dark:border-slate-600/40 dark:bg-gradient-to-br dark:from-slate-800/78 dark:to-slate-950/52"
    >
      <div
        style={{
          /** 整块泳道仍随画布 zoom，仅标题局部 counter-scale（原点左上）抵消视觉缩放 */
          transform: `scale(${inv})`,
          transformOrigin: 'top left',
          fontFamily: 'sans-serif',
        }}
        className="dark:text-slate-400"
      >
        {data.groupTitle ? (
          <div
            style={{
              fontSize: '9px',
              fontWeight: 600,
              letterSpacing: '0.12em',
              color: '#94a3b8',
              marginBottom: '2px',
            }}
          >
            {data.groupTitle}
          </div>
        ) : null}
        {canOpenCompare ? (
          <button
            type="button"
            onClick={openIncomeContrast}
            title={`利润对比：${compareStocks.length} 家公司`}
            style={{
              pointerEvents: 'auto',
              margin: 0,
              padding: 0,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.14em',
              color: '#2563eb',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            {data.title}
          </button>
        ) : (
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.14em',
              color: '#64748b',
            }}
          >
            {data.title}
          </div>
        )}
        {lanePos ? (
          <div
            style={{
              marginTop: '4px',
              fontSize: '10px',
              lineHeight: 1.35,
              color: '#475569',
              maxWidth: '92%',
            }}
          >
            <span style={{ color: '#64748b' }}>产业位置：</span>
            {lanePos}
          </div>
        ) : null}
        {certainty || elasticity ? (
          <div style={{ marginTop: '3px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            {certainty ? (
              <span style={{ fontSize: '10px', fontWeight: 700, color: getLevelColor(certainty) }}>
                {certainty}
              </span>
            ) : null}
            {elasticity ? (
              <span style={{ fontSize: '10px', fontWeight: 700, color: getLevelColor(elasticity) }}>
                {elasticity}
              </span>
            ) : null}
          </div>
        ) : null}
        {elasticityFactors && elasticityFactors.length > 0 ? (
          <div
            style={{
              marginTop: '3px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '3px',
              maxWidth: '100%',
            }}
          >
            {elasticityFactors.map((factor) => (
              <span
                key={factor}
                title={factor}
                style={{
                  pointerEvents: 'auto',
                  maxWidth: '160px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  border: '1px solid rgba(148,163,184,0.45)',
                  borderRadius: '4px',
                  padding: '1px 4px',
                  background: 'rgba(255,255,255,0.52)',
                  fontSize: '9px',
                  lineHeight: 1.25,
                  color: '#475569',
                  cursor: 'default',
                }}
              >
                {factor}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(SwimLaneNode);
