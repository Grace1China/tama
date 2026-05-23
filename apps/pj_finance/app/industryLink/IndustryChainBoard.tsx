'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import ReactFlow, {
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
  useStore,
  MarkerType,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { AI_COMPUTE_TAXONOMY, countAIComputeSubLanes } from './aiComputeTaxonomy';
import {
  AI_INDUSTRY_TAXONOMY,
  countAISubLanes,
  type AIIndustryTaxonomyFile,
} from './aiIndustryTaxonomy';
import IndustryNode, { type IndustryNodeData } from './industry';
import SwimLaneNode from './SwimLane';

/** 顶部 Tab 识别的产业链预设 */
export type ChainAnalysisPreset = 'lithium' | 'ai' | 'ai_compute';

const nodeTypes = { industry: IndustryNode, swimLane: SwimLaneNode };

const LAYER_ZH: Record<IndustryNodeData['category'], string> = {
  Upstream: '上游',
  Midstream: '中游',
  Downstream: '下游',
};

const LAYER_ORDER: IndustryNodeData['category'][] = ['Upstream', 'Midstream', 'Downstream'];

type SeedCompany = {
  id: string;
  category: IndustryNodeData['category'];
  label: string;
  pricingPower: IndustryNodeData['pricingPower'];
  competitiveAdvantage: string;
  valuationHint?: string;
};

/** 一条泳道：父节点 id + 左翼标题 + 该行公司/分类占位数据 */
export type BoardLayer = {
  parentId: string;
  tier: IndustryNodeData['category'];
  titleZh: string;
  row: SeedCompany[];
};

const SEED_COMPANIES: SeedCompany[] = [
  { id: 'tq', category: 'Upstream', label: '天齐锂业', pricingPower: 'High', competitiveAdvantage: '格林布什等优质矿权资源', valuationHint: '周期品看资源与冶炼' },
  { id: 'gf', category: 'Upstream', label: '赣锋锂业', pricingPower: 'High', competitiveAdvantage: '盐湖+锂化合物一体化布局' },
  { id: 'rb', category: 'Midstream', label: '容百科技', pricingPower: 'Medium', competitiveAdvantage: '高镍三元与海外市场' },
  { id: 'ds', category: 'Midstream', label: '当升科技', pricingPower: 'Medium', competitiveAdvantage: '动力电池正极大客户绑定' },
  { id: 'yn', category: 'Midstream', label: '湖南裕能', pricingPower: 'Low', competitiveAdvantage: '磷酸铁锂出货量与成本控制' },
  { id: 'catl', category: 'Downstream', label: '宁德时代', pricingPower: 'Medium', competitiveAdvantage: '全球动力电池装机与客户结构', valuationHint: '关注议价与回款' },
  { id: 'byd', category: 'Downstream', label: '比亚迪', pricingPower: 'High', competitiveAdvantage: '整车+电池闭环与规模' },
  { id: 'ew', category: 'Downstream', label: '亿纬锂能', pricingPower: 'Low', competitiveAdvantage: '圆柱+储能+动力多场景', valuationHint: '利润弹性' },
];

const GAP_X = 268;
const NODE_CARD_OUTER_WIDTH = 232;

/** AI 带子项多，收窄横向间距以利一排展示 */
const GAP_X_AI = 142;
const NODE_CARD_OUTER_WIDTH_AI = 220;

const BOARD_LAYOUT: Record<
  ChainAnalysisPreset,
  { gapX: number; nodeOuterWidth: number }
> = {
  lithium: { gapX: GAP_X, nodeOuterWidth: NODE_CARD_OUTER_WIDTH },
  ai: { gapX: GAP_X_AI, nodeOuterWidth: NODE_CARD_OUTER_WIDTH_AI },
  ai_compute: { gapX: GAP_X_AI, nodeOuterWidth: NODE_CARD_OUTER_WIDTH_AI },
};

/** 公司卡片距泳道顶的屏幕像素（近似）；流坐标下边距 ≈ 本值 ÷ zoom，使标题栏高度不随缩放漂移 */
const CHILD_TOP_SCREEN_PX = 52;
/** 单层泳带高度 = （视窗在流坐标下的高度 ÷ 层数）× 该系数；>1 时总高度超出视窗，可平移/滚轮浏览 */
const SWIM_LANE_BAND_HEIGHT_RATIO = 2;
/** 行内居中时保证距泳道内壁的最小留白 */
const ROW_INWARD_PAD_MIN = 32;

/** 页面侧栏等区域预留的外层最小可视高度提示 */
export const TOTAL_SWIM_LAYOUT_HEIGHT = 420;

function laneParentId(layer: IndustryNodeData['category']): string {
  return `lane-${layer}`;
}

function buildBoardLayersLithium(): BoardLayer[] {
  return LAYER_ORDER.map((layer) => ({
    parentId: laneParentId(layer),
    tier: layer,
    titleZh: LAYER_ZH[layer],
    row: SEED_COMPANIES.filter((s) => s.category === layer),
  })).filter((l) => l.row.length > 0);
}

/** 自 taxonomy 扁平为多泳道 layer；relations 暂不画边 */
function buildBoardLayersFromTaxonomy(
  tax: AIIndustryTaxonomyFile,
  nodeIdPrefix: 'aim' | 'aic',
): BoardLayer[] {
  const layers: BoardLayer[] = [];
  for (const lane of tax.lanes) {
    for (const sub of lane.sub_lanes) {
      const parentId = `${nodeIdPrefix}-${sub.id}`;
      layers.push({
        parentId,
        tier: lane.tier,
        titleZh: sub.title,
        row: sub.companies.map((c) => ({
          id: `${nodeIdPrefix}-${c.id}`,
          category: lane.tier,
          label: c.name,
          pricingPower: 'Medium' as IndustryNodeData['pricingPower'],
          competitiveAdvantage: `根泳道：${lane.title} · 关联数：${(c.relations ?? []).length}`,
          valuationHint: `${lane.title}`,
        })),
      });
    }
  }
  return layers;
}

export function buildBoardLayersForPreset(preset: ChainAnalysisPreset): BoardLayer[] {
  if (preset === 'lithium') return buildBoardLayersLithium();
  if (preset === 'ai_compute') return buildBoardLayersFromTaxonomy(AI_COMPUTE_TAXONOMY, 'aic');
  return buildBoardLayersFromTaxonomy(AI_INDUSTRY_TAXONOMY, 'aim');
}

function buildGroupedNodes(
  layers: BoardLayer[],
  laneLeftFlow: number,
  laneWidthFlow: number,
  laneTopFlow: number,
  laneBandHeightFlow: number,
  layout: { gapX: number; nodeOuterWidth: number },
  viewportZoom: number,
): Node[] {
  const zm = viewportZoom > 0 ? viewportZoom : 1;
  const lanesW = Math.max(1, Math.abs(laneWidthFlow));
  const laneH = Math.max(1, Math.abs(laneBandHeightFlow));
  const laneLeftCanvas = laneLeftFlow;
  const { gapX: GX, nodeOuterWidth: NOW } = layout;
  const childTopFlow = CHILD_TOP_SCREEN_PX / zm;

  const parents: Node[] = [];
  const children: Node[] = [];
  const lastIdx = Math.max(0, layers.length - 1);

  layers.forEach((layerMeta, layerIdx) => {
    const row = layerMeta.row;
    const n = row.length;

    const pid = layerMeta.parentId;
    const roundingMode = layerIdx === 0 ? 'top' : layerIdx === lastIdx ? 'bottom' : 'mid';
    const dividerBottom = layerIdx < lastIdx;

    const rowSpan = Math.max(0, n - 1) * GX + NOW;
    const padStartWithinLane = Math.max(ROW_INWARD_PAD_MIN, (lanesW - rowSpan) / 2);

    const laneTopY = laneTopFlow + layerIdx * laneH;

    // 即使没有公司卡片也要生成泳道矩形，否则会少条带（极简 YAML 五根只剩空行时已发生）
    parents.push({
      id: pid,
      type: 'swimLane',
      position: { x: laneLeftCanvas, y: laneTopY },
      style: {
        width: lanesW,
        height: laneH,
        zIndex: 0,
        overflow: 'hidden',
      },
      data: {
        title: layerMeta.titleZh,
        dividerBottom,
        roundingMode,
      },
      draggable: false,
      selectable: false,
      focusable: false,
      connectable: false,
    });

    if (n === 0) return;

    row.forEach((s, idx) => {
      children.push({
        id: s.id,
        type: 'industry',
        parentId: pid,
        extent: 'parent',
        position: {
          x: padStartWithinLane + idx * GX,
          y: childTopFlow,
        },
        zIndex: 1,
        data: {
          label: s.label,
          category: s.category,
          pricingPower: s.pricingPower,
          competitiveAdvantage: s.competitiveAdvantage,
          valuationHint: s.valuationHint,
          laneClip: { w: lanesW, h: laneH },
        },
      });
    });
  });

  return [...parents, ...children];
}

/** 版面比较容差（流坐标）；合并时过小变化复用引用减少 company 卡片重挂载闪动 */
const LAYOUT_MERGE_EPS = 0.2;

/** 缩放过程中流坐标极小抖动会引发每帧更新，量化后多数帧可复用上一条 layout */
const SNAP_FLOW_COORD = (v: number) => Math.round(v * 32) / 32;

function numFromStyle(style: Node['style'], key: string): number | undefined {
  if (!style) return undefined;
  const v = (style as Record<string, unknown>)[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

function laneStyleClose(a: Node['style'], b: Node['style']): boolean {
  const ra = (a ?? {}) as Record<string, unknown>;
  const rb = (b ?? {}) as Record<string, unknown>;
  if (String(ra.overflow ?? '') !== String(rb.overflow ?? '')) return false;
  if (String(ra.borderRadius ?? '') !== String(rb.borderRadius ?? '')) return false;
  const aw = numFromStyle(a, 'width') ?? NaN;
  const bw = numFromStyle(b, 'width') ?? NaN;
  const ah = numFromStyle(a, 'height') ?? NaN;
  const bh = numFromStyle(b, 'height') ?? NaN;
  return (
    Math.abs(aw - bw) < LAYOUT_MERGE_EPS && Math.abs(ah - bh) < LAYOUT_MERGE_EPS
  );
}

function industryLaneClipClose(da: unknown, db: unknown): boolean {
  const a = da as IndustryNodeData | undefined;
  const b = db as IndustryNodeData | undefined;
  if (!a?.laneClip || !b?.laneClip) return false;
  return (
    Math.abs(a.laneClip.w - b.laneClip.w) < LAYOUT_MERGE_EPS &&
    Math.abs(a.laneClip.h - b.laneClip.h) < LAYOUT_MERGE_EPS
  );
}

function mergeNodesPreservingStableRefs(prev: Node[], nextBuilt: Node[]): Node[] {
  const prevMap = new Map(prev.map((n) => [n.id, n]));
  return nextBuilt.map((nb) => {
    const pb = prevMap.get(nb.id);
    if (
      pb &&
      pb.type === nb.type &&
      pb.parentId === nb.parentId &&
      Math.abs(pb.position.x - nb.position.x) < LAYOUT_MERGE_EPS &&
      Math.abs(pb.position.y - nb.position.y) < LAYOUT_MERGE_EPS &&
      laneStyleClose(pb.style, nb.style) &&
      (pb.type !== 'industry' || industryLaneClipClose(pb.data, nb.data))
    ) {
      return pb;
    }
    if (pb?.data !== undefined && pb.type === 'swimLane') {
      return { ...nb, data: pb.data };
    }
    return nb;
  });
}

function createSeedEdgesLithium(): Edge[] {
  return [
    { id: 'e-tq-gf', source: 'tq', target: 'gf', sourceHandle: 'right-out', targetHandle: 'left-in' },
    { id: 'e-tq-rb', source: 'tq', target: 'rb', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e-gf-rb', source: 'gf', target: 'rb', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e-gf-yn', source: 'gf', target: 'yn', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e-tq-ds', source: 'tq', target: 'ds', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e-rb-ds', source: 'rb', target: 'ds', sourceHandle: 'right-out', targetHandle: 'left-in' },
    { id: 'e-ds-yn', source: 'ds', target: 'yn', sourceHandle: 'right-out', targetHandle: 'left-in' },
    { id: 'e-rb-catl', source: 'rb', target: 'catl', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e-ds-catl', source: 'ds', target: 'catl', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e-yn-byd', source: 'yn', target: 'byd', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e-yn-ew', source: 'yn', target: 'ew', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e-catl-byd', source: 'catl', target: 'byd', sourceHandle: 'right-out', targetHandle: 'left-in' },
    { id: 'e-byd-catl-back', source: 'byd', target: 'catl', sourceHandle: 'left-out', targetHandle: 'right-in' },
    { id: 'e-catl-ew', source: 'catl', target: 'ew', sourceHandle: 'right-out', targetHandle: 'left-in' },
  ];
}

function SwimlaneViewportSync({
  preset,
  layers,
  layout,
  setNodes,
  laneLayoutSyncNotifierRef,
}: {
  preset: ChainAnalysisPreset;
  layers: BoardLayer[];
  layout: { gapX: number; nodeOuterWidth: number };
  setNodes: Dispatch<SetStateAction<Node[]>>;
  /** 锂电 fitView/setViewport 后由外部触发一次对齐；AI 图谱若随视口平移每次都重锚泳道左上，会与滚轮平移抵消导致无法下移浏览 */
  laneLayoutSyncNotifierRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { screenToFlowPosition, getViewport } = useReactFlow();
  const domNode = useStore((s) => s.domNode);
  const zoomLevel = useStore((s) => s.transform[2]);
  const rafRef = useRef<number | null>(null);
  /** 锂电全量对齐；AI 仅 zoom 时使用 dimensions，且不覆盖 full */
  const pendingSyncKindRef = useRef<'full' | 'dimensions' | null>(null);
  const lastAppliedRef = useRef<{ lx: number; w: number; ty: number; bh: number } | null>(null);
  /** 非锂电：竖向锚点固定在流坐标（滚轮/pan Y 不改变），缩放时仅靠改泳道宽高流坐标以保持屏幕占位不变 */
  const frozenLaneTopRef = useRef<number | null>(null);
  /** 仅在 zoomLevel 抖动时触发 dimensions 对齐；首帧不写 prev */
  const prevZoomForDimSyncRef = useRef<number | null>(null);
  const layerCount = layers.length;

  useLayoutEffect(() => {
    lastAppliedRef.current = null;
    frozenLaneTopRef.current = null;
    prevZoomForDimSyncRef.current = null;
  }, [domNode, layerCount]);

  const runSyncLanes = useCallback(
    (modeIn: 'full' | 'dimensions') => {
      if (!(domNode instanceof HTMLElement)) return;
      if (layerCount < 1) return;
      const pane = domNode.getBoundingClientRect();
      const pl = pane.left;
      const pt = pane.top;
      const pr = pane.width;
      const pb = pane.height;
      if (pr < 2 || pb < 2) return;

      const zm = Math.max(Number.isFinite(getViewport().zoom) ? getViewport().zoom : 1, 1e-4);

      const leftMid = screenToFlowPosition({ x: pl, y: pt + pb / 2 });
      const rightMid = screenToFlowPosition({ x: pl + pr, y: pt + pb / 2 });
      const laneLeft = Math.min(leftMid.x, rightMid.x);
      const laneW = Math.max(Math.abs(rightMid.x - leftMid.x), 1);

      const topMid = screenToFlowPosition({ x: pl + pr / 2, y: pt });
      const botMid = screenToFlowPosition({ x: pl + pr / 2, y: pt + pb });
      const viewportTopFlow = Math.min(topMid.y, botMid.y);
      const viewportHFlow = Math.max(Math.abs(botMid.y - topMid.y), 1);
      const bandHRaw = (viewportHFlow / layerCount) * SWIM_LANE_BAND_HEIGHT_RATIO;

      const laneLeftQ = SNAP_FLOW_COORD(laneLeft);
      const laneWQ = Math.max(SNAP_FLOW_COORD(laneW), 1);
      const viewportTopQ = SNAP_FLOW_COORD(viewportTopFlow);
      const bandHQ = Math.max(SNAP_FLOW_COORD(bandHRaw), 1);

      let mode = modeIn;
      if (preset !== 'lithium' && mode === 'dimensions' && frozenLaneTopRef.current === null)
        mode = 'full';

      const laneTopQ =
        preset !== 'lithium' && mode === 'dimensions' && frozenLaneTopRef.current !== null
          ? frozenLaneTopRef.current
          : viewportTopQ;

      if (preset !== 'lithium' && mode === 'full') frozenLaneTopRef.current = laneTopQ;

      const prev = lastAppliedRef.current;
      if (
        prev &&
        Math.abs(prev.lx - laneLeftQ) < LAYOUT_MERGE_EPS &&
        Math.abs(prev.w - laneWQ) < LAYOUT_MERGE_EPS &&
        Math.abs(prev.ty - laneTopQ) < LAYOUT_MERGE_EPS &&
        Math.abs(prev.bh - bandHQ) < LAYOUT_MERGE_EPS
      )
        return;
      lastAppliedRef.current = { lx: laneLeftQ, w: laneWQ, ty: laneTopQ, bh: bandHQ };
      const nextBuilt = buildGroupedNodes(
        layers,
        laneLeftQ,
        laneWQ,
        laneTopQ,
        bandHQ,
        layout,
        zm,
      );
      setNodes((p) => mergeNodesPreservingStableRefs(p, nextBuilt));
    },
    [domNode, screenToFlowPosition, getViewport, preset, setNodes, layers, layout, layerCount],
  );

  const flushQueuedSync = useCallback(() => {
    rafRef.current = null;
    const kind = pendingSyncKindRef.current;
    pendingSyncKindRef.current = null;
    if (kind !== null) runSyncLanes(kind);
  }, [runSyncLanes]);

  /** 外层容器变更 / 锂电拖拽视口：全量重对齐 */
  const scheduleFullSync = useCallback(() => {
    pendingSyncKindRef.current = 'full';
    if (rafRef.current == null)
      rafRef.current = requestAnimationFrame(() => {
        flushQueuedSync();
      });
  }, [flushQueuedSync]);

  /** 仅 zoom 变了：在非锂电模式下重算泳道流坐标宽高，使屏幕上泳带占位近似不变（公司卡片仍按流坐标缩放） */
  const scheduleDimensionsOnlySync = useCallback(() => {
    if (preset === 'lithium') return;
    if (pendingSyncKindRef.current !== 'full') pendingSyncKindRef.current = 'dimensions';
    if (rafRef.current == null)
      rafRef.current = requestAnimationFrame(() => {
        flushQueuedSync();
      });
  }, [preset, flushQueuedSync]);

  useEffect(() => {
    if (preset === 'lithium') return;
    const z = zoomLevel;
    const prev = prevZoomForDimSyncRef.current;
    prevZoomForDimSyncRef.current = z;
    if (prev != null && Math.abs(prev - z) > 1e-6) scheduleDimensionsOnlySync();
  }, [zoomLevel, preset, scheduleDimensionsOnlySync]);

  useLayoutEffect(() => {
    scheduleFullSync();
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [scheduleFullSync]);

  useLayoutEffect(() => {
    if (!(domNode instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      scheduleFullSync();
    });
    ro.observe(domNode);
    return () => ro.disconnect();
  }, [domNode, scheduleFullSync]);

  /** 锂电：fitView / 拖拽画布后仍需按视窗重算泳带；AI：视口 XY 不重算锚点（见 scheduleDimensionsOnlySync） */
  useOnViewportChange({
    onChange: preset === 'lithium' ? scheduleFullSync : undefined,
    onEnd: preset === 'lithium' ? scheduleFullSync : undefined,
  });

  useEffect(() => {
    if (!laneLayoutSyncNotifierRef) return undefined;
    laneLayoutSyncNotifierRef.current = scheduleFullSync;
    return () => {
      laneLayoutSyncNotifierRef.current = null;
    };
  }, [laneLayoutSyncNotifierRef, scheduleFullSync]);

  return null;
}

/** AI 图谱：滚轮在主区域纵向平移视口。须在 capture 阶段拦截：RF/d3-zoom 在子节点上冒泡前就 consume 掉 wheel，导致冒泡监听无效。 */
function AiViewportWheelPan({ preset }: { preset: ChainAnalysisPreset }) {
  const { getViewport, setViewport } = useReactFlow();
  const domNode = useStore((s) => s.domNode);

  useEffect(() => {
    if (preset === 'lithium') return undefined;

    const onWheelCapture = (e: WheelEvent) => {
      if (!(domNode instanceof HTMLElement)) return;
      const t = e.target;
      if (!(t instanceof Node) || !domNode.contains(t)) return;
      if (e.ctrlKey || e.metaKey) return;

      const dominant = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!dominant) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      const vp = getViewport();
      setViewport({ x: vp.x, y: vp.y - dominant, zoom: vp.zoom }, { duration: 0 });
    };

    /** capture + passive:false 早于子元素上的滚轮缩放逻辑 */
    window.addEventListener('wheel', onWheelCapture, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', onWheelCapture, true);
  }, [preset, domNode, getViewport, setViewport]);

  return null;
}

function FlowContent({ preset }: { preset: ChainAnalysisPreset }) {
  const rfRef = useRef<ReactFlowInstance | null>(null);
  /** 非锂电：onInit setViewport / fitView 之后补跑一次泳带对齐（不再监听每次视口平移，以免抵消滚轮） */
  const laneLayoutSyncNotifierRef = useRef<(() => void) | null>(null);
  const layers = useMemo(() => buildBoardLayersForPreset(preset), [preset]);
  const layout = BOARD_LAYOUT[preset];
  const initialNodes = buildGroupedNodes(layers, 0, 1024, 0, 200, layout, 1);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    preset === 'lithium' ? createSeedEdgesLithium() : [],
  );

  const onFlowInit = useCallback(
    (inst: ReactFlowInstance) => {
      rfRef.current = inst;
      requestAnimationFrame(() => {
        /** 锂电保持 fitView；AI 图谱层数多时 fitView 会整体缩小导致条带过扁，仅用 zoom=1 + 下移浏览 */
        if (preset === 'lithium') {
          inst.fitView({ padding: 0, duration: 0 });
        } else {
          inst.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
          /** 等泳道 Sync 挂载并把 scheduleSync 挂到 ref 后再对齐一帧（双 rAF 晚于子组件 effect） */
          requestAnimationFrame(() => laneLayoutSyncNotifierRef.current?.());
        }
      });
    },
    [preset],
  );

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, animated: false }, eds)),
    [setEdges],
  );

  return (
    <ReactFlow
      className="h-full w-full bg-transparent"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onInit={onFlowInit}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      fitView={false}
      /** 锂电滚轮缩放；AI 图谱用滚轮纵向平移交子组件 AiViewportWheelPan（passive:false） */
      zoomOnScroll={preset === 'lithium'}
      connectionLineStyle={{ stroke: '#94a3b8', strokeWidth: 2 }}
      defaultEdgeOptions={{
        markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b', width: 16, height: 16 },
        style: { strokeWidth: 1.6, stroke: '#64748b' },
      }}
      proOptions={{ hideAttribution: true }}
    >
      <AiViewportWheelPan preset={preset} />
      <SwimlaneViewportSync
        preset={preset}
        layers={layers}
        layout={layout}
        setNodes={setNodes}
        laneLayoutSyncNotifierRef={preset !== 'lithium' ? laneLayoutSyncNotifierRef : undefined}
      />
      <Background gap={18} />
      <Controls />
      <MiniMap zoomable pannable />
    </ReactFlow>
  );
}

function IndustryChainFlow({ preset }: { preset: ChainAnalysisPreset }) {
  return (
    <div className="h-full w-full min-h-0 min-w-0">
      <ReactFlowProvider key={preset}>
        <FlowContent preset={preset} />
      </ReactFlowProvider>
    </div>
  );
}

const AI_SWIM_LANE_COUNT = countAISubLanes();

export default function IndustryChainBoard({ preset }: { preset: ChainAnalysisPreset }) {
  const isLithium = preset === 'lithium';
  const isAi = preset === 'ai';
  const isAiCompute = preset === 'ai_compute';
  return (
    <div className="flex w-full min-h-0 flex-col gap-2">
      {/* min-h-0：内部 React Flow 在窄父级下可收缩；不用 flex-1：避免 Tab 版面纵向撑开产生大块空白 */}
      <div className="shrink-0 space-y-1 text-sm text-muted-foreground">
        {isLithium && (
          <>
            <p>
              泳道矩形按 <code className="rounded bg-muted px-1 py-px text-xs">.react-flow</code> 根的浏览器包围盒对齐
              <code className="rounded bg-muted px-1 py-px text-xs">screenToFlowPosition</code>
              ，使视觉上铺满画布；纵向均等分画布高度；
              <code className="rounded bg-muted px-1 py-px text-xs">fitView</code> padding 已关。</p>
            <p className="text-xs">
              锂电池示例：上下游三层泳道，带示例企业与连线。卡片经 <code className="rounded bg-muted px-1 py-px text-xs">laneClip</code> 防越层盖住下一泳道。
            </p>
          </>
        )}
        {(isAi || isAiCompute) && (
          <p className="text-xs">
            泳带内容高于一屏时，请在画布区域使用滚轮纵向平移视口；画布缩放（如 Ctrl+滚轮或触控板捏合）时泳道在屏幕上的占位大致不变，公司卡片随之放大缩小便于阅读。
          </p>
        )}
        {isAi && (
          <p className="text-xs">
            AI产业链 YAML 当前仅列根泳道：
            {AI_INDUSTRY_TAXONOMY.lanes.map((l) => l.title).join('、')}；共 {AI_SWIM_LANE_COUNT}{' '}
            条同名子泳带占位；公司与关联边待 YAML 再扩展。
          </p>
        )}
        {isAiCompute && (
          <p className="text-xs">
            AI算力产业链 YAML：根泳道 {AI_COMPUTE_TAXONOMY.lanes.map((l) => l.title).join('、')}；共{' '}
            {countAIComputeSubLanes()} 条泳带占位；公司与关联待 YAML 扩展。
          </p>
        )}
      </div>
      <div
        style={{ minHeight: Math.min(TOTAL_SWIM_LAYOUT_HEIGHT, 980) }}
        className="relative min-h-[420px] h-[min(980px,calc(100vh-10rem))] w-full overflow-hidden rounded-md border border-border bg-muted/20"
      >
        <IndustryChainFlow preset={preset} />
      </div>
    </div>
  );
}
