'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import YAML from 'yaml';
import ReactFlow, {
  ReactFlowProvider,
  Background,
  PanOnScrollMode,
  addEdge,
  useEdgesState,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
  useStore,
  useStoreApi,
  MarkerType,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type Viewport,
} from 'reactflow';
import 'reactflow/dist/style.css';

import aiComputeYamlRaw from './ai_compute_taxonomy.yaml';
import aiIndustryYamlRaw from './ai_industry_taxonomy.yaml';
import taoIndustryYamlRaw from './tao_industry_taxonomy.yaml';
import scQuantumIndustryYamlRaw from './sc_quantum_industry_taxonomy.yaml';
import commercialSpaceIndustryYamlRaw from './commercial_space_industry_taxonomy.yaml';
import { AI_COMPUTE_TAXONOMY } from './aiComputeTaxonomy';
import { COMMERCIAL_SPACE_INDUSTRY_TAXONOMY } from './commercialSpaceIndustryTaxonomy';
import { SC_QUANTUM_INDUSTRY_TAXONOMY } from './scQuantumIndustryTaxonomy';
import { TAO_INDUSTRY_TAXONOMY } from './taoIndustryTaxonomy';
import {
  AI_INDUSTRY_TAXONOMY,
  buildFlowEdgesFromTaxonomy,
  parseIndustryTaxonomyYaml,
  pricingPowerFromCompanyInfo,
  type AIIndustryTaxonomyFile,
} from './aiIndustryTaxonomy';
import IndustryBoardYamlView from './IndustryBoardYamlView';
import IndustryNode, { type IndustryNodeData } from './industry';
import { tsCodeForCompanyName } from './industryCompanyTsCodes';
import SwimLaneNode from './SwimLane';
import { CompanyCardGestureZoom, CompanyCardZoomControls, CompanyCardZoomProvider } from './companyCardZoom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/** 顶部 Tab 识别的产业链预设 */
export type ChainAnalysisPreset =
  | 'lithium'
  | 'ai'
  | 'ai_compute'
  | 'tao'
  | 'sc_quantum'
  | 'commercial_space';

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
  tsCode?: string;
  /** YAML info 块（韬产业链等） */
  companyInfo?: Record<string, string>;
  cardDetailVariant?: IndustryNodeData['cardDetailVariant'];
};

export type BoardLayer = {
  parentId: string;
  tier: IndustryNodeData['category'];
  /** 子泳道标题（画布条带主标题） */
  titleZh: string;
  /** 根泳道标题；与 titleZh 不同时展示为分组前缀 */
  groupTitleZh?: string;
  /** 子泳道级产业链说明（产业位置、确定性、弹性等） */
  subLaneInfo?: Record<string, string>;
  /** 公司卡片起始 Y（屏幕像素）；含子泳道说明时自动加高 */
  childTopScreenPx?: number;
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

/** 屏幕像素：公司卡片横向间距（zoom 时在流坐标中除以 zoom，屏幕观感不变） */
const GAP_X_SCREEN = 268;
const NODE_CARD_OUTER_WIDTH_SCREEN = 232;
/** AI 预设卡片间距：须 ≥ 卡片宽度，避免折叠态头部横向重叠 */
const NODE_CARD_OUTER_WIDTH_SCREEN_AI = 220;
const GAP_X_SCREEN_AI = NODE_CARD_OUTER_WIDTH_SCREEN_AI + 12;

const BOARD_LAYOUT: Record<
  ChainAnalysisPreset,
  { gapXScreen: number; nodeOuterWidthScreen: number }
> = {
  lithium: { gapXScreen: GAP_X_SCREEN, nodeOuterWidthScreen: NODE_CARD_OUTER_WIDTH_SCREEN },
  ai: { gapXScreen: GAP_X_SCREEN_AI, nodeOuterWidthScreen: NODE_CARD_OUTER_WIDTH_SCREEN_AI },
  ai_compute: { gapXScreen: GAP_X_SCREEN_AI, nodeOuterWidthScreen: NODE_CARD_OUTER_WIDTH_SCREEN_AI },
  tao: { gapXScreen: GAP_X_SCREEN_AI, nodeOuterWidthScreen: NODE_CARD_OUTER_WIDTH_SCREEN_AI },
  sc_quantum: { gapXScreen: GAP_X_SCREEN_AI, nodeOuterWidthScreen: NODE_CARD_OUTER_WIDTH_SCREEN_AI },
  commercial_space: { gapXScreen: GAP_X_SCREEN_AI, nodeOuterWidthScreen: NODE_CARD_OUTER_WIDTH_SCREEN_AI },
};

/** 公司卡片距泳道顶部的屏幕像素（默认，无子泳道说明时） */
const CHILD_TOP_SCREEN_PX = 52;

/** 子泳道有产业位置/确定性/弹性说明时，为公司卡片额外下移 */
function computeSubLaneChildTopScreenPx(info?: Record<string, string>): number {
  if (!info || Object.keys(info).length === 0) return CHILD_TOP_SCREEN_PX;
  let top = CHILD_TOP_SCREEN_PX;
  if (info.产业位置?.trim()) top += 16;
  if (info.确定性?.trim() || info.弹性?.trim()) top += 14;
  return top;
}
/**
 * 单层泳道固定屏幕高度（px）；单行卡片时的默认高度，多行时按行数自动加高。
 * 需容纳 CHILD_TOP + 公司卡片，可按视觉调大/调小。
 */
export const SWIM_LANE_BAND_SCREEN_PX = 220;

/** 看板可视区域最大高度；内容超出时在画布内滚轮纵向浏览 */
const SWIM_BOARD_VIEWPORT_MAX_CSS = 'min(980px, calc(100vh - 10rem))';

/** 行内居中时距泳道左右内壁的最小屏幕留白 */
const ROW_INWARD_PAD_SCREEN_MIN = 32;
/** 折叠态公司卡片单行占用高度（屏幕像素） */
const CARD_ROW_HEIGHT_SCREEN_PX = 72;
/** 换行时行间距（屏幕像素） */
const CARD_ROW_GAP_Y_SCREEN_PX = 8;
/** 泳道底部留白（屏幕像素） */
const LANE_BOTTOM_PAD_SCREEN_PX = 16;
/** 估算画布宽（用于首屏高度 CSS，ResizeObserver 后会按真实宽度重算） */
const ESTIMATED_PANE_WIDTH_PX = 1200;

type BoardCardLayout = { gapXScreen: number; nodeOuterWidthScreen: number };

/** 单行最多可放卡片数（不超出泳道宽） */
function computeCardsPerRow(
  laneWidth: number,
  layout: BoardCardLayout,
  padMin = ROW_INWARD_PAD_SCREEN_MIN,
): number {
  const { gapXScreen: gapX, nodeOuterWidthScreen: cardW } = layout;
  const inner = laneWidth - 2 * padMin;
  if (inner <= cardW) return 1;
  return Math.max(1, Math.floor((inner - cardW) / gapX) + 1);
}

/** 泳道内公司卡片换行坐标 */
function computeWrappedCardPositions(
  count: number,
  laneWidth: number,
  layout: BoardCardLayout,
  childTop: number,
  padMin = ROW_INWARD_PAD_SCREEN_MIN,
): { positions: { x: number; y: number }[]; rowCount: number } {
  if (count <= 0) return { positions: [], rowCount: 0 };

  const { gapXScreen: gapX, nodeOuterWidthScreen: cardW } = layout;
  const perRow = computeCardsPerRow(laneWidth, layout, padMin);
  const rowCount = Math.ceil(count / perRow);
  const positions: { x: number; y: number }[] = [];
  const rowStep = CARD_ROW_HEIGHT_SCREEN_PX + CARD_ROW_GAP_Y_SCREEN_PX;

  for (let idx = 0; idx < count; idx++) {
    const row = Math.floor(idx / perRow);
    const col = idx % perRow;
    const rowStartIdx = row * perRow;
    const cardsInRow = Math.min(perRow, count - rowStartIdx);
    const rowSpan = Math.max(0, cardsInRow - 1) * gapX + cardW;
    const padStart = Math.max(padMin, (laneWidth - rowSpan) / 2);
    positions.push({
      x: padStart + col * gapX,
      y: childTop + row * rowStep,
    });
  }

  return { positions, rowCount };
}

/** 按卡片行数计算泳道高度（屏幕像素） */
function computeLaneHeightScreenPx(rowCount: number, childTop = CHILD_TOP_SCREEN_PX): number {
  if (rowCount <= 0) return SWIM_LANE_BAND_SCREEN_PX;
  const cardRows =
    rowCount * CARD_ROW_HEIGHT_SCREEN_PX + Math.max(0, rowCount - 1) * CARD_ROW_GAP_Y_SCREEN_PX;
  return Math.max(
    SWIM_LANE_BAND_SCREEN_PX,
    childTop + cardRows + LANE_BOTTOM_PAD_SCREEN_PX,
  );
}

/** 全部泳道内容总高（按换行后的各行高度累加） */
export function computeSwimBoardCanvasHeightPx(
  layers: BoardLayer[],
  laneWidthPx: number,
  layout: BoardCardLayout,
): number {
  if (layers.length === 0) return SWIM_LANE_BAND_SCREEN_PX;
  return layers.reduce((sum, layer) => {
    const childTop = layer.childTopScreenPx ?? CHILD_TOP_SCREEN_PX;
    const { rowCount } = computeWrappedCardPositions(
      layer.row.length,
      laneWidthPx,
      layout,
      childTop,
    );
    return sum + computeLaneHeightScreenPx(rowCount, childTop);
  }, 0);
}

/** 看板可视区域高度 CSS：内容总高与上限取较小值 */
export function computeSwimBoardViewportHeightCss(
  layers: BoardLayer[],
  laneWidthPx: number,
  layout: BoardCardLayout,
): string {
  const contentPx = computeSwimBoardCanvasHeightPx(layers, laneWidthPx, layout);
  return `min(${contentPx}px, ${SWIM_BOARD_VIEWPORT_MAX_CSS})`;
}

/** 泳道固定缩放比：不可缩放，滚轮仅纵向平移浏览 */
const SWIM_LANE_FIXED_ZOOM = 1;
/** 首条泳道顶边流坐标：恒为 0，与画布上沿对齐 */
const SWIM_LANE_TOP_FLOW = 0;

export const TOTAL_SWIM_LAYOUT_HEIGHT = SWIM_LANE_BAND_SCREEN_PX;

/** 泳道布局快照：供视口约束与节点重建共用 */
type SwimLaneLayoutSnapshot = {
  laneLeftFlow: number;
  laneWidthFlow: number;
  laneTopFlow: number;
  bandHeightFlow: number;
  layerCount: number;
  paneWidthPx: number;
  /** 可视区域（React Flow pane）高度 */
  paneHeightPx: number;
  /** 全部泳道内容总高（屏幕像素） */
  contentHeightPx: number;
  bandHeightScreenPx: number;
  /** 视口 transform.y 下界（末泳道贴底）；上界见 computeViewportYBounds */
  viewportYMax: number;
  viewportYMin: number;
};

/** React Flow / d3 平移边界：流坐标内容矩形，高 = 全部泳道总高 */
function computeSwimContentFlowExtent(
  snap: Pick<SwimLaneLayoutSnapshot, 'paneWidthPx' | 'contentHeightPx'>,
): [[number, number], [number, number]] {
  return [
    [0, 0],
    [Math.max(snap.paneWidthPx, 1), Math.max(snap.contentHeightPx, 1)],
  ];
}

type SwimLaneLayoutHost = HTMLElement & {
  __swimLaneLayout?: SwimLaneLayoutSnapshot;
};

function laneParentId(layer: IndustryNodeData['category']): string {
  return `lane-${layer}`;
}

function buildBoardLayersLithium(): BoardLayer[] {
  return LAYER_ORDER.map((layer) => ({
    parentId: laneParentId(layer),
    tier: layer,
    titleZh: LAYER_ZH[layer],
    row: SEED_COMPANIES.filter((s) => s.category === layer).map((s) => ({
      ...s,
      tsCode: tsCodeForCompanyName(s.label),
    })),
  })).filter((l) => l.row.length > 0);
}

/** 从 YAML info 解析可点击公告用的 ts_code */
function tsCodeFromCompanyInfo(
  info: Record<string, string>,
  ts_code?: string,
  companyName?: string,
): string | undefined {
  const raw = (ts_code ?? info.ts_code ?? info.tsCode ?? info.代码 ?? '').trim();
  if (/^\d{6}\.(SZ|SH|BJ)$/i.test(raw)) return raw.toUpperCase();
  if (companyName) {
    const fromMap = tsCodeForCompanyName(companyName);
    if (fromMap) return fromMap;
  }
  return undefined;
}

function buildBoardLayersFromTaxonomy(
  tax: AIIndustryTaxonomyFile,
  nodeIdPrefix: 'aim' | 'aic' | 'lit' | 'tao' | 'scq' | 'csp',
): BoardLayer[] {
  const layers: BoardLayer[] = [];
  for (const lane of tax.lanes) {
    for (const sub of lane.sub_lanes) {
      const parentId = `${nodeIdPrefix}-${sub.id}`;
      layers.push({
        parentId,
        tier: lane.tier,
        titleZh: sub.title,
        groupTitleZh: lane.title !== sub.title ? lane.title : undefined,
        subLaneInfo: sub.info,
        childTopScreenPx: computeSubLaneChildTopScreenPx(sub.info),
        row: sub.companies.map((c) => {
          const info = c.info ?? {};
          const tsCode = tsCodeFromCompanyInfo(info, c.ts_code, c.name);

          if (nodeIdPrefix === 'tao') {
            return {
              id: `${nodeIdPrefix}-${c.id}`,
              category: lane.tier,
              label: c.name,
              pricingPower: 'Medium' as IndustryNodeData['pricingPower'],
              competitiveAdvantage: '',
              tsCode,
              companyInfo: { ...info },
              cardDetailVariant: 'tao' as const,
            };
          }

          if (nodeIdPrefix === 'scq') {
            return {
              id: `${nodeIdPrefix}-${c.id}`,
              category: lane.tier,
              label: c.name,
              pricingPower: 'Medium' as IndustryNodeData['pricingPower'],
              competitiveAdvantage: '',
              tsCode,
              companyInfo: { ...info },
              cardDetailVariant: 'sc_quantum' as const,
            };
          }

          if (nodeIdPrefix === 'csp') {
            return {
              id: `${nodeIdPrefix}-${c.id}`,
              category: lane.tier,
              label: c.name,
              pricingPower: 'Medium' as IndustryNodeData['pricingPower'],
              competitiveAdvantage: '',
              tsCode,
              companyInfo: { ...info },
              cardDetailVariant: 'commercial_space' as const,
            };
          }

          const competitiveAdvantage =
            info.竞争优势 ??
            info.competitive_advantage ??
            info.competitiveAdvantage ??
            `根泳道：${lane.title} · 关联数：${(c.relations ?? []).length}`;
          const valuationHint =
            info.估值提示 ?? info.valuation_hint ?? info.valuationHint ?? lane.title;
          return {
            id: `${nodeIdPrefix}-${c.id}`,
            category: lane.tier,
            label: c.name,
            pricingPower: pricingPowerFromCompanyInfo(info),
            competitiveAdvantage: String(competitiveAdvantage),
            valuationHint: String(valuationHint),
            tsCode,
          };
        }),
      });
    }
  }
  return layers;
}

export function buildBoardLayersForPreset(preset: ChainAnalysisPreset): BoardLayer[] {
  if (preset === 'lithium') return buildBoardLayersLithium();
  if (preset === 'ai_compute') return buildBoardLayersFromTaxonomy(AI_COMPUTE_TAXONOMY, 'aic');
  if (preset === 'tao') return buildBoardLayersFromTaxonomy(TAO_INDUSTRY_TAXONOMY, 'tao');
  if (preset === 'sc_quantum') return buildBoardLayersFromTaxonomy(SC_QUANTUM_INDUSTRY_TAXONOMY, 'scq');
  if (preset === 'commercial_space') {
    return buildBoardLayersFromTaxonomy(COMMERCIAL_SPACE_INDUSTRY_TAXONOMY, 'csp');
  }
  return buildBoardLayersFromTaxonomy(AI_INDUSTRY_TAXONOMY, 'aim');
}

function nodeIdPrefixForPreset(
  preset: ChainAnalysisPreset,
): 'aim' | 'aic' | 'lit' | 'tao' | 'scq' | 'csp' {
  if (preset === 'ai_compute') return 'aic';
  if (preset === 'ai') return 'aim';
  if (preset === 'tao') return 'tao';
  if (preset === 'sc_quantum') return 'scq';
  if (preset === 'commercial_space') return 'csp';
  return 'lit';
}

function buildLithiumDefaultYaml(): string {
  const layers = buildBoardLayersLithium();
  const edges = createSeedEdgesLithium();
  const labelById = Object.fromEntries(SEED_COMPANIES.map((c) => [c.id, c.label]));
  const seedById = Object.fromEntries(SEED_COMPANIES.map((c) => [c.id, c]));
  const linksBySourceId: Record<string, Record<string, string>> = {};
  for (const e of edges) {
    if (!linksBySourceId[e.source]) linksBySourceId[e.source] = {};
    linksBySourceId[e.source][labelById[e.target]] = '上下游';
  }
  const categoryMap: Record<string, unknown[]> = {};
  for (const layer of layers) {
    categoryMap[layer.titleZh] = layer.row.map((c) => {
      const seed = seedById[c.id];
      const linkMap = linksBySourceId[c.id];
      const info: Record<string, string> = {
        定价权: seed.pricingPower,
        竞争优势: seed.competitiveAdvantage,
      };
      if (seed.valuationHint) info.估值提示 = seed.valuationHint;
      const body: Record<string, unknown> = { info };
      if (linkMap && Object.keys(linkMap).length > 0) body.link = linkMap;
      return { [c.label]: body };
    });
  }
  return YAML.stringify(categoryMap);
}

function builtinTaxonomyForPreset(preset: ChainAnalysisPreset): AIIndustryTaxonomyFile {
  if (preset === 'ai_compute') return AI_COMPUTE_TAXONOMY;
  if (preset === 'ai') return AI_INDUSTRY_TAXONOMY;
  if (preset === 'tao') return TAO_INDUSTRY_TAXONOMY;
  if (preset === 'sc_quantum') return SC_QUANTUM_INDUSTRY_TAXONOMY;
  if (preset === 'commercial_space') return COMMERCIAL_SPACE_INDUSTRY_TAXONOMY;
  return parseIndustryTaxonomyYaml(buildLithiumDefaultYaml());
}

export function defaultYamlTextForPreset(preset: ChainAnalysisPreset): string {
  if (preset === 'ai') return String(aiIndustryYamlRaw);
  if (preset === 'ai_compute') return String(aiComputeYamlRaw);
  if (preset === 'tao') return String(taoIndustryYamlRaw);
  if (preset === 'sc_quantum') return String(scQuantumIndustryYamlRaw);
  if (preset === 'commercial_space') return String(commercialSpaceIndustryYamlRaw);
  return buildLithiumDefaultYaml();
}

function buildBoardLayersFromYamlTaxonomy(
  preset: ChainAnalysisPreset,
  tax: AIIndustryTaxonomyFile,
): BoardLayer[] {
  return buildBoardLayersFromTaxonomy(tax, nodeIdPrefixForPreset(preset));
}

const LAYOUT_MERGE_EPS = 0.2;
const SNAP_FLOW_COORD = (v: number) => Math.round(v * 32) / 32;

/** 屏幕像素 → 流坐标（zoom 越大流坐标越小，屏幕尺寸保持不变） */
function screenToFlowSize(screenPx: number, zoom: number): number {
  const zm = zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
  return screenPx / zm;
}

/** 读取 React Flow 画布尺寸（client 宽高 = 可视区域，与泳道屏幕宽对齐） */
function readPaneMetrics(dom: HTMLElement): { width: number; height: number; rect: DOMRect } {
  const rect = dom.getBoundingClientRect();
  return {
    width: Math.max(dom.clientWidth, 1),
    height: Math.max(dom.clientHeight, 1),
    rect,
  };
}

/**
 * 泳道宽度控制：始终等于 React Flow 画布 clientWidth（屏幕像素）。
 * 画布变宽/变窄、或 zoom 改变时，由 SwimlaneViewportSync + ResizeObserver 重新调用。
 */
export function computeLaneWidthScreenPx(paneWidthPx: number): number {
  return Math.max(paneWidthPx, 1);
}

/** 泳道流坐标宽 = 画布 clientWidth ÷ zoom；屏幕投影后恒等于画布宽 */
export function computeLaneWidthFlow(paneWidthPx: number, zoom: number): number {
  const zm = Math.max(Number.isFinite(zoom) ? zoom : 1, 1e-4);
  return Math.max(computeLaneWidthScreenPx(paneWidthPx) / zm, 1);
}

/** 泳道左缘：视口横向锁定 x=0 时固定为 0，与画布左缘对齐 */
export function computeLaneLeftFlow(_viewport: Viewport): number {
  return 0;
}

/**
 * 根据画布像素尺寸与 zoom 计算泳道流坐标布局。
 * 宽度：动态铺满 .react-flow 根元素 client 宽；高度：按各泳道换行后的行数累加。
 */
function computeSwimLaneLayout(
  paneWidthPx: number,
  paneViewportHeightPx: number,
  layers: BoardLayer[],
  layout: BoardCardLayout,
  viewport: Viewport,
): SwimLaneLayoutSnapshot | null {
  if (layers.length < 1 || paneWidthPx < 2 || paneViewportHeightPx < 2) return null;

  const zm = Math.max(Number.isFinite(viewport.zoom) ? viewport.zoom : 1, 1e-4);
  const laneWidthFlow = computeLaneWidthFlow(paneWidthPx, zm);
  const contentHeightPx = computeSwimBoardCanvasHeightPx(layers, laneWidthFlow, layout);

  const snap: SwimLaneLayoutSnapshot = {
    laneLeftFlow: computeLaneLeftFlow(viewport),
    laneWidthFlow,
    laneTopFlow: SWIM_LANE_TOP_FLOW,
    bandHeightFlow: Math.max(SNAP_FLOW_COORD(screenToFlowSize(SWIM_LANE_BAND_SCREEN_PX, zm)), 1),
    layerCount: layers.length,
    paneWidthPx,
    paneHeightPx: paneViewportHeightPx,
    contentHeightPx,
    bandHeightScreenPx: SWIM_LANE_BAND_SCREEN_PX,
    viewportYMax: 0,
    viewportYMin: 0,
  };
  const bounds = computeViewportYBounds(snap);
  snap.viewportYMax = bounds.maxY;
  snap.viewportYMin = bounds.minY;
  return snap;
}

/** 视口 transform.y 上下界：首泳道贴顶 / 末泳道贴底（与 translateExtent 配合） */
function computeViewportYBounds(snap: SwimLaneLayoutSnapshot): { minY: number; maxY: number } {
  const maxY = 0;
  const minY =
    snap.contentHeightPx <= snap.paneHeightPx ? maxY : snap.paneHeightPx - snap.contentHeightPx;
  return { minY, maxY };
}

function buildGroupedNodes(
  layers: BoardLayer[],
  snap: SwimLaneLayoutSnapshot,
  layout: BoardCardLayout,
): Node[] {
  const lanesW = snap.laneWidthFlow;
  const rowPadMinFlow = ROW_INWARD_PAD_SCREEN_MIN;

  const parents: Node[] = [];
  const children: Node[] = [];
  const lastIdx = Math.max(0, layers.length - 1);
  let cumulativeTopY = snap.laneTopFlow;

  layers.forEach((layerMeta, layerIdx) => {
    const row = layerMeta.row;
    const n = row.length;
    const pid = layerMeta.parentId;
    const childTopFlow = layerMeta.childTopScreenPx ?? CHILD_TOP_SCREEN_PX;
    const roundingMode = layerIdx === 0 ? 'top' : layerIdx === lastIdx ? 'bottom' : 'mid';
    const dividerBottom = layerIdx < lastIdx;
    const { positions, rowCount } = computeWrappedCardPositions(
      n,
      lanesW,
      layout,
      childTopFlow,
      rowPadMinFlow,
    );
    const laneHeightScreen = computeLaneHeightScreenPx(rowCount, childTopFlow);
    const laneH = laneHeightScreen;
    const laneTopY = cumulativeTopY;

    parents.push({
      id: pid,
      type: 'swimLane',
      position: { x: 0, y: laneTopY },
      style: {
        width: lanesW,
        minWidth: lanesW,
        maxWidth: lanesW,
        height: laneH,
        zIndex: 0,
        overflow: 'hidden',
      },
      data: {
        title: layerMeta.titleZh,
        groupTitle: layerMeta.groupTitleZh,
        subLaneInfo: layerMeta.subLaneInfo,
        dividerBottom,
        roundingMode,
      },
      draggable: false,
      selectable: false,
      focusable: false,
      connectable: false,
    });

    row.forEach((s, idx) => {
      const pos = positions[idx];
      children.push({
        id: s.id,
        type: 'industry',
        parentId: pid,
        extent: 'parent',
        position: pos,
        zIndex: 1,
        data: {
          label: s.label,
          category: s.category,
          pricingPower: s.pricingPower,
          competitiveAdvantage: s.competitiveAdvantage,
          valuationHint: s.valuationHint,
          laneClip: { w: lanesW, h: laneH },
          cardWidthScreen: layout.nodeOuterWidthScreen,
          tsCode: s.tsCode,
          companyInfo: s.companyInfo,
          cardDetailVariant: s.cardDetailVariant,
        },
        draggable: true,
        selectable: false,
        connectable: false,
      });
    });

    cumulativeTopY += laneH;
  });

  return [...parents, ...children];
}

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
  const aw = numFromStyle(a, 'width') ?? NaN;
  const bw = numFromStyle(b, 'width') ?? NaN;
  const ah = numFromStyle(a, 'height') ?? NaN;
  const bh = numFromStyle(b, 'height') ?? NaN;
  return Math.abs(aw - bw) < LAYOUT_MERGE_EPS && Math.abs(ah - bh) < LAYOUT_MERGE_EPS;
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

function industryNodeBizDataClose(da: unknown, db: unknown): boolean {
  const a = da as IndustryNodeData | undefined;
  const b = db as IndustryNodeData | undefined;
  if (!a || !b) return false;
  const infoA = JSON.stringify(a.companyInfo ?? {});
  const infoB = JSON.stringify(b.companyInfo ?? {});
  return (
    a.label === b.label &&
    a.category === b.category &&
    a.pricingPower === b.pricingPower &&
    a.competitiveAdvantage === b.competitiveAdvantage &&
    (a.valuationHint ?? '') === (b.valuationHint ?? '') &&
    (a.tsCode ?? '') === (b.tsCode ?? '') &&
    (a.cardDetailVariant ?? 'default') === (b.cardDetailVariant ?? 'default') &&
    infoA === infoB &&
    (a.cardWidthScreen ?? 0) === (b.cardWidthScreen ?? 0)
  );
}

function mergeNodesPreservingStableRefs(prev: Node[], nextBuilt: Node[]): Node[] {
  const prevMap = new Map(prev.map((n) => [n.id, n]));
  return nextBuilt.map((nb) => {
    const pb = prevMap.get(nb.id);
    /** 用户拖过位的公司卡片：布局同步时保留 position，仅更新 laneClip 等随泳道变化的字段 */
    if (
      pb &&
      pb.type === 'industry' &&
      nb.type === 'industry' &&
      pb.parentId === nb.parentId &&
      industryNodeBizDataClose(pb.data, nb.data)
    ) {
      return {
        ...nb,
        position: pb.position,
        data: {
          ...(pb.data as IndustryNodeData),
          laneClip: (nb.data as IndustryNodeData).laneClip,
        },
      };
    }
    if (
      pb &&
      pb.type === nb.type &&
      pb.parentId === nb.parentId &&
      Math.abs(pb.position.x - nb.position.x) < LAYOUT_MERGE_EPS &&
      Math.abs(pb.position.y - nb.position.y) < LAYOUT_MERGE_EPS &&
      laneStyleClose(pb.style, nb.style) &&
      (pb.type !== 'industry' ||
        (industryLaneClipClose(pb.data, nb.data) &&
          industryNodeBizDataClose(pb.data, nb.data)))
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

/** 约束视口：zoom 固定、横向 x=0、纵向限制在首/末泳道之间 */
function clampViewportToSwimLanes(
  vp: Viewport,
  snap: SwimLaneLayoutSnapshot,
  setViewport: (v: Viewport, opts?: { duration?: number }) => void,
) {
  const zm = SWIM_LANE_FIXED_ZOOM;
  const { minY, maxY } = computeViewportYBounds(snap);
  const nextY = Math.min(maxY, Math.max(minY, vp.y));
  const nextX = 0;
  if (
    Math.abs(vp.x - nextX) > 1e-6 ||
    Math.abs(vp.y - nextY) > 1e-6 ||
    Math.abs(vp.zoom - zm) > 1e-6
  ) {
    setViewport({ x: nextX, y: nextY, zoom: zm }, { duration: 0 });
  }
}

function SwimlaneViewportSync({
  layers,
  layout,
  setNodes,
  laneLayoutSyncNotifierRef,
}: {
  layers: BoardLayer[];
  layout: { gapXScreen: number; nodeOuterWidthScreen: number };
  setNodes: Dispatch<SetStateAction<Node[]>>;
  laneLayoutSyncNotifierRef: React.MutableRefObject<(() => void) | null>;
}) {
  const { getViewport, setViewport } = useReactFlow();
  const storeApi = useStoreApi();
  const domNode = useStore((s) => s.domNode);
  const rafRef = useRef<number | null>(null);
  const pendingSyncKindRef = useRef<'full' | 'dimensions' | null>(null);
  const lastAppliedRef = useRef<SwimLaneLayoutSnapshot | null>(null);
  const layerCount = layers.length;

  useLayoutEffect(() => {
    lastAppliedRef.current = null;
  }, [domNode, layerCount]);

  const runSyncLanes = useCallback(
    (_modeIn: 'full' | 'dimensions') => {
      if (!(domNode instanceof HTMLElement)) return;
      if (layerCount < 1) return;

      const { width: paneW, height: paneH } = readPaneMetrics(domNode);
      const vp = getViewport();
      /** zoom 固定为 1，横向 x=0；纵向 y 由滚轮控制 */
      if (
        Math.abs(vp.x) > 1e-6 ||
        Math.abs(vp.zoom - SWIM_LANE_FIXED_ZOOM) > 1e-6
      ) {
        setViewport({ x: 0, y: vp.y, zoom: SWIM_LANE_FIXED_ZOOM }, { duration: 0 });
      }
      const vpLocked = getViewport();

      const snap = computeSwimLaneLayout(paneW, paneH, layers, layout, vpLocked);
      if (!snap) return;

      const applyContentExtent = (s: SwimLaneLayoutSnapshot) => {
        const extent = computeSwimContentFlowExtent(s);
        storeApi.getState().setTranslateExtent(extent);
        storeApi.getState().setNodeExtent(extent);
      };

      const prev = lastAppliedRef.current;
      if (
        prev &&
        Math.abs(prev.paneWidthPx - snap.paneWidthPx) < 0.5 &&
        Math.abs(prev.paneHeightPx - snap.paneHeightPx) < 0.5 &&
        Math.abs(prev.contentHeightPx - snap.contentHeightPx) < 0.5 &&
        Math.abs(prev.laneLeftFlow - snap.laneLeftFlow) < LAYOUT_MERGE_EPS &&
        Math.abs(prev.laneWidthFlow - snap.laneWidthFlow) < LAYOUT_MERGE_EPS &&
        Math.abs(prev.bandHeightFlow - snap.bandHeightFlow) < LAYOUT_MERGE_EPS &&
        prev.layerCount === snap.layerCount
      ) {
        (domNode as SwimLaneLayoutHost).__swimLaneLayout = snap;
        applyContentExtent(snap);
        clampViewportToSwimLanes(getViewport(), snap, setViewport);
        return;
      }

      lastAppliedRef.current = snap;
      (domNode as SwimLaneLayoutHost).__swimLaneLayout = snap;
      applyContentExtent(snap);

      const nextBuilt = buildGroupedNodes(layers, snap, layout);
      setNodes((p) => mergeNodesPreservingStableRefs(p, nextBuilt));
      clampViewportToSwimLanes(getViewport(), snap, setViewport);
    },
    [domNode, getViewport, setViewport, storeApi, setNodes, layers, layout, layerCount],
  );

  const flushQueuedSync = useCallback(() => {
    rafRef.current = null;
    const kind = pendingSyncKindRef.current;
    pendingSyncKindRef.current = null;
    if (kind !== null) runSyncLanes(kind);
  }, [runSyncLanes]);

  const scheduleFullSync = useCallback(() => {
    pendingSyncKindRef.current = 'full';
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(flushQueuedSync);
    }
  }, [flushQueuedSync]);

  useLayoutEffect(() => {
    scheduleFullSync();
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [scheduleFullSync]);

  useLayoutEffect(() => {
    if (!(domNode instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => scheduleFullSync());
    ro.observe(domNode);
    return () => ro.disconnect();
  }, [domNode, scheduleFullSync]);

  useEffect(() => {
    laneLayoutSyncNotifierRef.current = scheduleFullSync;
    return () => {
      laneLayoutSyncNotifierRef.current = null;
    };
  }, [laneLayoutSyncNotifierRef, scheduleFullSync]);

  return null;
}

/** 缩放或平移后约束视口范围（仅纵向、zoom 固定） */
function SwimLaneViewportClamp() {
  const { getViewport, setViewport } = useReactFlow();
  const domNode = useStore((s) => s.domNode);

  const clamp = useCallback(() => {
    if (!(domNode instanceof HTMLElement)) return;
    const snap = (domNode as SwimLaneLayoutHost).__swimLaneLayout;
    if (!snap) return;
    clampViewportToSwimLanes(getViewport(), snap, setViewport);
  }, [domNode, getViewport, setViewport]);

  useOnViewportChange({ onChange: clamp, onEnd: clamp });

  return null;
}

function FlowContent({
  preset,
  layers,
  flowEdges,
}: {
  preset: ChainAnalysisPreset;
  layers: BoardLayer[];
  flowEdges: Edge[];
}) {
  const laneLayoutSyncNotifierRef = useRef<(() => void) | null>(null);
  const layout = BOARD_LAYOUT[preset];
  const boardContentHeightPx = computeSwimBoardCanvasHeightPx(
    layers,
    ESTIMATED_PANE_WIDTH_PX,
    layout,
  );
  const initialLaneWidth = ESTIMATED_PANE_WIDTH_PX;
  const initialContentHeightPx = computeSwimBoardCanvasHeightPx(layers, initialLaneWidth, layout);
  const initialContentExtent = useMemo(
    (): [[number, number], [number, number]] => [
      [0, 0],
      [initialLaneWidth, initialContentHeightPx],
    ],
    [initialLaneWidth, initialContentHeightPx],
  );
  const initialSnap: SwimLaneLayoutSnapshot = {
    laneLeftFlow: 0,
    laneWidthFlow: initialLaneWidth,
    laneTopFlow: SWIM_LANE_TOP_FLOW,
    bandHeightFlow: SWIM_LANE_BAND_SCREEN_PX,
    layerCount: layers.length,
    paneWidthPx: initialLaneWidth,
    paneHeightPx: Math.min(boardContentHeightPx, 600),
    contentHeightPx: initialContentHeightPx,
    bandHeightScreenPx: SWIM_LANE_BAND_SCREEN_PX,
    viewportYMax: 0,
    viewportYMin: 0,
  };
  const initialNodes = buildGroupedNodes(layers, initialSnap, layout);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  const onFlowInit = useCallback((inst: ReactFlowInstance) => {
    inst.setViewport({ x: 0, y: 0, zoom: SWIM_LANE_FIXED_ZOOM }, { duration: 0 });
    requestAnimationFrame(() => laneLayoutSyncNotifierRef.current?.());
  }, []);

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
      minZoom={SWIM_LANE_FIXED_ZOOM}
      maxZoom={SWIM_LANE_FIXED_ZOOM}
      translateExtent={initialContentExtent}
      nodeExtent={initialContentExtent}
      nodesDraggable
      nodeDragThreshold={2}
      elementsSelectable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      panOnScroll
      panOnScrollMode={PanOnScrollMode.Vertical}
      panOnScrollSpeed={1}
      preventScrolling
      connectionLineStyle={{ stroke: '#94a3b8', strokeWidth: 2 }}
      defaultEdgeOptions={{
        markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b', width: 16, height: 16 },
        style: { strokeWidth: 1.6, stroke: '#64748b' },
      }}
      proOptions={{ hideAttribution: true }}
    >
      <SwimLaneViewportClamp />
      <SwimlaneViewportSync
        layers={layers}
        layout={layout}
        setNodes={setNodes}
        laneLayoutSyncNotifierRef={laneLayoutSyncNotifierRef}
      />
      <CompanyCardGestureZoom />
      <Background gap={18} />
    </ReactFlow>
  );
}

function IndustryChainFlow({
  preset,
  layers,
  flowKey,
  flowEdges,
}: {
  preset: ChainAnalysisPreset;
  layers: BoardLayer[];
  flowKey: string;
  flowEdges: Edge[];
}) {
  return (
    <CompanyCardZoomProvider key={flowKey}>
      <div className="relative h-full w-full min-h-0 min-w-0">
        <ReactFlowProvider key={flowKey}>
          <FlowContent preset={preset} layers={layers} flowEdges={flowEdges} />
        </ReactFlowProvider>
        <CompanyCardZoomControls />
      </div>
    </CompanyCardZoomProvider>
  );
}

export default function IndustryChainBoard({ preset }: { preset: ChainAnalysisPreset }) {
  const defaultYaml = useMemo(() => defaultYamlTextForPreset(preset), [preset]);
  const [yamlDraft, setYamlDraft] = useState(defaultYaml);
  const [lastAppliedYaml, setLastAppliedYaml] = useState<string | null>(null);
  const [yamlApplied, setYamlApplied] = useState<AIIndustryTaxonomyFile | null>(null);
  const [yamlParseError, setYamlParseError] = useState<string | null>(null);
  const [yamlSaving, setYamlSaving] = useState(false);
  const [flowRevision, setFlowRevision] = useState(0);

  useEffect(() => {
    setYamlDraft(defaultYaml);
    setLastAppliedYaml(null);
    setYamlApplied(null);
    setYamlParseError(null);
    setFlowRevision((r) => r + 1);
  }, [preset, defaultYaml]);

  const pendingApply = yamlDraft !== (lastAppliedYaml ?? defaultYaml);

  const handleYamlDraftChange = useCallback((next: string) => {
    setYamlDraft(next);
    setYamlParseError(null);
  }, []);

  const handleYamlApply = useCallback(async () => {
    let tax: AIIndustryTaxonomyFile;
    try {
      tax = parseIndustryTaxonomyYaml(yamlDraft);
    } catch (err) {
      setYamlParseError(err instanceof Error ? err.message : String(err));
      return;
    }

    setYamlSaving(true);
    setYamlParseError(null);
    try {
      const res = await fetch('/api/industry-link/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset, content: yamlDraft }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setYamlParseError(payload.error ?? `保存 YAML 失败 (${res.status})`);
        return;
      }

      setYamlApplied(tax);
      setLastAppliedYaml(yamlDraft);
      setFlowRevision((r) => r + 1);
    } catch (err) {
      setYamlParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setYamlSaving(false);
    }
  }, [yamlDraft, preset]);

  const handleYamlReset = useCallback(() => {
    const d = defaultYamlTextForPreset(preset);
    setYamlDraft(d);
    setYamlApplied(null);
    setLastAppliedYaml(null);
    setYamlParseError(null);
    setFlowRevision((r) => r + 1);
  }, [preset]);

  const activeTaxonomy = useMemo(
    () => yamlApplied ?? builtinTaxonomyForPreset(preset),
    [preset, yamlApplied],
  );

  const layers = useMemo(
    () => buildBoardLayersFromYamlTaxonomy(preset, activeTaxonomy),
    [preset, activeTaxonomy],
  );

  const flowEdges = useMemo(
    () => buildFlowEdgesFromTaxonomy(activeTaxonomy, nodeIdPrefixForPreset(preset)) as Edge[],
    [activeTaxonomy, preset],
  );

  const boardViewportHeightCss = computeSwimBoardViewportHeightCss(
    layers,
    ESTIMATED_PANE_WIDTH_PX,
    BOARD_LAYOUT[preset],
  );
  const flowKey = `${preset}-${flowRevision}`;

  return (
    <div className="flex w-full min-h-0 flex-col gap-2">
      <Tabs defaultValue="graph" className="flex w-full flex-col gap-2">
        <TabsList className="h-9 w-fit shrink-0">
          <TabsTrigger value="graph">图形视图</TabsTrigger>
          <TabsTrigger value="yaml">YAML 编辑器</TabsTrigger>
        </TabsList>
        <TabsContent value="graph" className="mt-0 focus-visible:outline-none">
          <div
            style={{ height: boardViewportHeightCss }}
            className="relative min-h-[420px] w-full overflow-hidden rounded-md border border-border bg-muted/20"
          >
            <IndustryChainFlow
              preset={preset}
              layers={layers}
              flowKey={flowKey}
              flowEdges={flowEdges}
            />
          </div>
        </TabsContent>
        <TabsContent value="yaml" className="mt-0 focus-visible:outline-none">
          <IndustryBoardYamlView
            yamlText={yamlDraft}
            heightCss={boardViewportHeightCss}
            onDraftChange={handleYamlDraftChange}
            onApply={handleYamlApply}
            onReset={handleYamlReset}
            parseError={yamlParseError}
            pendingApply={pendingApply}
            saving={yamlSaving}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
