/**
 * AI 产业链泳道 YAML 解析与运行时只读常量
 * - 数据结构见 ai_industry_taxonomy.yaml
 */

import YAML from 'yaml';
import taxonomyYamlRaw from './ai_industry_taxonomy.yaml';

/** 与 IndustryChainBoard、产业链节点 category 配色对齐 */
export type AISegmentTier = 'Upstream' | 'Midstream' | 'Downstream';

/** 公司之间的关联（第四层）；target_id 指向其它公司的 id */
export interface AICompanyRelation {
  target_id: string;
  relation_zh: string;
}

/** 第三层：公司占位，后续可由年报归因等替换为真实标的 */
export interface AICompanyNode {
  id: string;
  name: string;
  relations: AICompanyRelation[];
}

/** 第二层：子泳道 */
export interface AISubLane {
  id: string;
  title: string;
  companies: AICompanyNode[];
}

/** 第一层：根泳道（电力、芯片…） */
export interface AIRootLane {
  id: string;
  title: string;
  tier: AISegmentTier;
  sub_lanes: AISubLane[];
}

export interface AIIndustryTaxonomyFile {
  version: string;
  name?: string;
  description?: string;
  lanes: AIRootLane[];
}

/** 极简 YAML：仅为根泳道中文字符串数组时，自动生成「一层子泳道 + 尚无公司节点」的结构 */
function lanesFromTitleList(rows: unknown[]): AIRootLane[] {
  const titles = rows.map((x) => String(x).trim()).filter(Boolean);
  if (titles.length === 0) {
    throw new Error('产业链 taxonomy YAML: 至少须有一条根泳道名称');
  }
  const tiers: AISegmentTier[] = ['Upstream', 'Upstream', 'Midstream', 'Midstream', 'Downstream'];
  return titles.map((title, i) => ({
    id: `lane-${i}`,
    title,
    tier: tiers[i % tiers.length],
    sub_lanes: [
      {
        id: `sub-${i}`,
        title,
        companies: [],
      },
    ],
  }));
}

/** 「类别 → 公司名列表」YAML 顶层映射转成内部 lanes（每层类别一条泳带，公司为节点） */
function lanesFromCategoryCompanyMap(record: Record<string, unknown>): AIRootLane[] {
  const entries = Object.entries(record).filter(
    ([, v]) =>
      Array.isArray(v) && (v as unknown[]).every((x) => x == null || typeof x !== 'object'),
  ) as [string, unknown[]][];

  if (entries.length === 0) {
    throw new Error('产业链 taxonomy YAML: 须提供「类别: [公司……]」或使用 lanes 结构');
  }

  const tiers: AISegmentTier[] = ['Upstream', 'Upstream', 'Midstream', 'Midstream', 'Downstream'];
  return entries.map(([titleRaw, arr], laneIdx) => {
    const title = String(titleRaw).trim();
    const names = (arr as unknown[])
      .map((x) => String(x ?? '').trim())
      .filter(Boolean);
    const companies = names.map((name, j) => ({
      id: `co-${laneIdx}-${j}`,
      name,
      relations: [] as AICompanyRelation[],
    }));
    return {
      id: `lane-${laneIdx}`,
      title,
      tier: tiers[laneIdx % tiers.length],
      sub_lanes: [
        {
          id: `sub-${laneIdx}`,
          title,
          companies,
        },
      ],
    };
  });
}

/** 解析任意产业链 YAML：
 * - 根为字符串数组：仅类别名；
 * - 根为 `{ 类别: [公司……] }`：两列最简写法；
 * - 根为 `{ lanes: [...] }`：完整结构；
 */
export function parseIndustryTaxonomyYaml(raw: string): AIIndustryTaxonomyFile {
  const doc = YAML.parse(raw);
  if (Array.isArray(doc)) {
    return { version: '2.3.0', lanes: lanesFromTitleList(doc) };
  }
  if (doc && typeof doc === 'object') {
    const maybe = doc as Record<string, unknown>;
    if (Array.isArray(maybe['lanes'])) {
      return doc as AIIndustryTaxonomyFile;
    }
    return { version: '2.5.0', lanes: lanesFromCategoryCompanyMap(maybe) };
  }
  throw new Error('产业链 taxonomy YAML: 未知根类型');
}

export const AI_INDUSTRY_TAXONOMY: AIIndustryTaxonomyFile =
  typeof taxonomyYamlRaw === 'string'
    ? parseIndustryTaxonomyYaml(taxonomyYamlRaw)
    : parseIndustryTaxonomyYaml(String(taxonomyYamlRaw));

/** 扁平：第二层子泳道数量（与 React Flow 条带行数对应） */
export function countAISubLanes(): number {
  return AI_INDUSTRY_TAXONOMY.lanes.reduce((n, lane) => n + lane.sub_lanes.length, 0);
}

/** 扁平：所有公司 id→节点，便于校验证 relations.target_id */
export function companyById(): Map<string, AICompanyNode> {
  const m = new Map<string, AICompanyNode>();
  for (const lane of AI_INDUSTRY_TAXONOMY.lanes) {
    for (const sub of lane.sub_lanes) {
      for (const c of sub.companies) {
        m.set(c.id, c);
      }
    }
  }
  return m;
}

/** 展开所有定向关联边（来源公司 id → 目标 id）供后续画连线 */
export function listCompanyRelationEdges(): { from_id: string; to_id: string; relation_zh: string }[] {
  const edges: { from_id: string; to_id: string; relation_zh: string }[] = [];
  const known = companyById();
  for (const [, c] of known) {
    for (const r of c.relations ?? []) {
      if (!r?.target_id) continue;
      edges.push({
        from_id: c.id,
        to_id: r.target_id,
        relation_zh: r.relation_zh ?? '',
      });
    }
  }
  return edges;
}
