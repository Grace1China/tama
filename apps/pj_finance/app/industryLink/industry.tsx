import React, { memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';

// 1. 严格定义节点的数据结构，包含你关注的定性指标
export interface IndustryNodeData {
  label: string;
  category: 'Upstream' | 'Midstream' | 'Downstream';
  pricingPower: 'High' | 'Medium' | 'Low';
  competitiveAdvantage: string;
  valuationHint?: string; // 用于展示如「TTM PE: 25x」等定量映射
  /** 父泳道在流坐标下的宽高；用于裁剪卡片（RF 父子在 DOM 为兄弟节点） */
  laneClip: { w: number; h: number };
}

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
  const self = getNode(id);
  const rx = self?.position.x ?? 0;
  const ry = self?.position.y ?? 0;
  const lw = data.laneClip.w;
  const lh = data.laneClip.h;
  const clipW = Math.max(4, lw - rx);
  const clipH = Math.max(4, lh - ry);

  const layerAccent =
    data.category === 'Upstream'
      ? '#059669'
      : data.category === 'Midstream'
        ? '#d97706'
        : '#2563eb';

  const cardInner = (
    <div style={{
      padding: '12px',
      borderRadius: '8px',
      background: '#ffffff',
      border: '2px solid #e5e7eb',
      borderLeft: `4px solid ${layerAccent}`,
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      width: '220px',
      fontFamily: 'sans-serif',
      boxSizing: 'border-box',
    }}>
      {/* 上、下：典型纵向链路；左、右各一对 target/source（上下错开便于手工连线互不挡） */}
      <Handle id="top" type="target" position={Position.Top} style={{ background: '#64748b' }} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={{ background: '#64748b' }} />
      <Handle id="left-in" type="target" position={Position.Left} style={{ top: '32%', background: '#64748b' }} />
      <Handle id="left-out" type="source" position={Position.Left} style={{ top: '68%', background: '#64748b' }} />
      <Handle id="right-in" type="target" position={Position.Right} style={{ top: '32%', background: '#64748b' }} />
      <Handle id="right-out" type="source" position={Position.Right} style={{ top: '68%', background: '#64748b' }} />
      
      {/* 节点标题区 */}
      <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '8px', marginBottom: '8px' }}>
        <div style={{ fontSize: '11px', color: '#6b7280', letterSpacing: '0.02em' }}>
          {data.category === 'Upstream' ? '上游' : data.category === 'Midstream' ? '中游' : '下游'}
          <span style={{ marginLeft: 6, textTransform: 'uppercase', opacity: 0.75 }}>({data.category})</span>
        </div>
        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#111827' }}>
          {data.label}
        </div>
      </div>

      {/* 核心投研指标区 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#4b5563' }}>定价权:</span>
          <span style={{ 
            fontWeight: 'bold', 
            color: getPricingPowerColor(data.pricingPower) 
          }}>
            {data.pricingPower}
          </span>
        </div>
        
        <div style={{ fontSize: '12px' }}>
          <span style={{ color: '#4b5563', display: 'block', marginBottom: '2px' }}>竞争优势 (护城河):</span>
          <span style={{ color: '#111827', lineHeight: '1.4' }}>
            {data.competitiveAdvantage}
          </span>
        </div>

        {data.valuationHint && (
          <div style={{ fontSize: '11px', color: '#2563eb', marginTop: '4px', textAlign: 'right' }}>
            {data.valuationHint}
          </div>
        )}
      </div>

    </div>
  );

  return (
    <div
      style={{
        maxWidth: clipW,
        maxHeight: clipH,
        overflow: 'hidden',
        /** 与子 extent:parent 对齐，避免因 maxWidth 产生额外偏移 */
        margin: 0,
        padding: 0,
      }}
    >
      {cardInner}
    </div>
  );
};

export default memo(IndustryNode);