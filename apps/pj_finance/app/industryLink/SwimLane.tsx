import React, { memo } from 'react';
import type { NodeProps } from 'reactflow';
import { useStore } from 'reactflow';

/** 泳道父容器（React Flow parent）；须显式宽高；三层竖向拼接时 roundingMode 控制圆角与分割 */
export type SwimLaneNodeData = {
  title: string;
  /** 层底部分割线（最下一层一般 false，避免与画布底重复） */
  dividerBottom?: boolean;
  roundingMode?: 'top' | 'mid' | 'bottom' | 'single';
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
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.14em',
          color: '#64748b',
        }}
        className="dark:text-slate-400"
      >
        {data.title}
      </div>
    </div>
  );
}

export default memo(SwimLaneNode);
