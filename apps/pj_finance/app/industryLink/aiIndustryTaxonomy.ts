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
  /** Tushare 风格证券代码（如 688041.SH）；可与 industry_company_ts_codes 映射并存 */
  ts_code?: string;
  /** YAML info 块：定价权、竞争优势等 */
  info?: Record<string, string>;
}

/** 第二层：子泳道 */
export interface AISubLane {
  id: string;
  title: string;
  companies: AICompanyNode[];
  /** 子泳道级产业链说明（产业位置、确定性、弹性等；非单家公司 info） */
  info?: Record<string, string>;
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

/** 解析「类别映射」YAML 中公司一项：纯字符串，或 { name / label, ts_code 等 } */
function parseCompanyYamlEntry(item: unknown): { name: string; ts_code?: string } | null {
  const draft = parseCompanyListItem(item);
  if (!draft) return null;
  return draft.ts_code ? { name: draft.name, ts_code: draft.ts_code } : { name: draft.name };
}

/** YAML 关联块键名 */
const COMPANY_LINK_KEYS = ['link', 'links', '关联', '关联公司', 'relations', '下游', 'relate'];
/** YAML 企业信息块键名 */
const COMPANY_INFO_KEYS = ['info', '信息'];

type CompanyLinkDraft = { targetName: string; relation_zh: string };

type CompanyListDraft = {
  name: string;
  ts_code?: string;
  links: CompanyLinkDraft[];
  info: Record<string, string>;
};

function stringifyInfoValue(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v
      .map((item) => String(item).trim())
      .filter(Boolean)
      .join('\n');
  }
  return String(v).trim();
}

function parseInfoRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const text = stringifyInfoValue(v);
    if (!text) continue;
    out[String(k).trim()] = text;
  }
  return out;
}

/** link 可为 map、字符串数组，或 [{ 公司: 关系 }] */
function parseLinkEntries(raw: unknown): CompanyLinkDraft[] {
  const out: CompanyLinkDraft[] = [];
  if (raw == null) return out;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' || typeof item === 'number') {
        const targetName = String(item).trim();
        if (targetName) out.push({ targetName, relation_zh: '上下游' });
        continue;
      }
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          const targetName = String(k).trim();
          if (!targetName) continue;
          out.push({
            targetName,
            relation_zh: v == null ? '上下游' : String(v).trim() || '上下游',
          });
        }
      }
    }
    return out;
  }
  if (typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const targetName = String(k).trim();
      if (!targetName) continue;
      out.push({
        targetName,
        relation_zh: v == null ? '上下游' : String(v).trim() || '上下游',
      });
    }
  }
  return out;
}

function mergeCompanyChildBlock(draft: CompanyListDraft, block: unknown) {
  if (block == null) return;
  if (typeof block === 'string' || typeof block === 'number') {
    const targetName = String(block).trim();
    if (targetName) draft.links.push({ targetName, relation_zh: '上下游' });
    return;
  }
  if (typeof block !== 'object' || Array.isArray(block)) return;
  const o = block as Record<string, unknown>;
  for (const k of COMPANY_LINK_KEYS) {
    if (k in o) draft.links.push(...parseLinkEntries(o[k]));
  }
  for (const k of COMPANY_INFO_KEYS) {
    if (k in o) draft.info = { ...draft.info, ...parseInfoRecord(o[k]) };
  }
  const tc = o.ts_code ?? o.tsCode;
  if (tc != null && String(tc).trim()) draft.ts_code = String(tc).trim();
}

function parseCompanyChildren(val: unknown): { links: CompanyLinkDraft[]; info: Record<string, string> } {
  const draft: CompanyListDraft = { name: '', links: [], info: {} };
  if (Array.isArray(val)) {
    for (const block of val) mergeCompanyChildBlock(draft, block);
  } else if (val && typeof val === 'object') {
    mergeCompanyChildBlock(draft, val);
  }
  return { links: draft.links, info: draft.info };
}

/** 从 info 读取定价权 */
export function pricingPowerFromCompanyInfo(
  info?: Record<string, string>,
): 'High' | 'Medium' | 'Low' {
  const raw = info?.定价权 ?? info?.pricing_power ?? info?.pricingPower ?? '';
  const s = String(raw).trim().toLowerCase();
  if (s === 'high' || s === '高') return 'High';
  if (s === 'low' || s === '低') return 'Low';
  if (s === 'medium' || s === '中') return 'Medium';
  return 'Medium';
}

/** 泳道内公司项：字符串 | { 公司名: [link/info…] } | { name, link, info } */
function parseCompanyListItem(item: unknown): CompanyListDraft | null {
  if (item == null) return null;
  if (typeof item === 'string' || typeof item === 'number') {
    const name = String(item).trim();
    return name ? { name, links: [], info: {} } : null;
  }
  if (typeof item !== 'object' || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  const nameRaw = o.name ?? o.label;
  if (nameRaw != null) {
    const name = String(nameRaw).trim();
    if (!name) return null;
    const draft: CompanyListDraft = { name, links: [], info: {} };
    mergeCompanyChildBlock(draft, o);
    for (const k of COMPANY_LINK_KEYS) {
      if (k in o) draft.links.push(...parseLinkEntries(o[k]));
    }
    for (const k of COMPANY_INFO_KEYS) {
      if (k in o) draft.info = { ...draft.info, ...parseInfoRecord(o[k]) };
    }
    const tc = o.ts_code ?? o.tsCode ?? draft.info.ts_code;
    if (tc != null && String(tc).trim()) draft.ts_code = String(tc).trim();
    return draft;
  }
  const keys = Object.keys(o).filter(
    (k) =>
      !COMPANY_LINK_KEYS.includes(k) &&
      !COMPANY_INFO_KEYS.includes(k) &&
      k !== 'ts_code' &&
      k !== 'tsCode',
  );
  if (keys.length !== 1) return null;
  const name = keys[0].trim();
  if (!name) return null;
  const val = o[keys[0]];
  const { links, info } = parseCompanyChildren(val);
  const tc = o.ts_code ?? o.tsCode ?? info.ts_code;
  return {
    name,
    links,
    info,
    ...(tc != null && String(tc).trim() ? { ts_code: String(tc).trim() } : {}),
  };
}

function resolveRelationsInTaxonomy(tax: AIIndustryTaxonomyFile): AIIndustryTaxonomyFile {
  const nameToId = new Map<string, string>();
  const idSet = new Set<string>();
  for (const lane of tax.lanes) {
    for (const sub of lane.sub_lanes) {
      for (const c of sub.companies) {
        nameToId.set(c.name, c.id);
        idSet.add(c.id);
      }
    }
  }
  for (const lane of tax.lanes) {
    for (const sub of lane.sub_lanes) {
      for (const c of sub.companies) {
        c.relations = (c.relations ?? [])
          .map((r) => {
            if (idSet.has(r.target_id)) return r;
            const byName = nameToId.get(String(r.target_id).trim());
            if (byName) {
              return { ...r, target_id: byName, relation_zh: r.relation_zh || '上下游' };
            }
            return null;
          })
          .filter(Boolean) as AICompanyRelation[];
      }
    }
  }
  return tax;
}

/** 是否为「公司列表」数组（扁平泳道写法） */
function isCompanyListArray(val: unknown): boolean {
  if (!Array.isArray(val)) return false;
  return (val as unknown[]).every((x) => parseCompanyListItem(x) != null);
}

/** 子泳道下存放公司列表的键名（与泳道元数据字段并存时使用） */
const SUB_LANE_COMPANY_KEYS = ['公司', 'companies'] as const;

type SubLaneBlock = { info: Record<string, string>; companies: CompanyListDraft[] };

/** 解析子泳道：纯公司数组，或「产业位置/确定性/弹性… + 公司: […]」 */
function parseSubLaneBlock(val: unknown): SubLaneBlock | null {
  if (isCompanyListArray(val)) {
    return {
      info: {},
      companies: (val as unknown[])
        .map((x) => parseCompanyListItem(x))
        .filter(Boolean) as CompanyListDraft[],
    };
  }
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null;

  const o = val as Record<string, unknown>;
  let companyRaw: unknown[] | null = null;
  for (const k of SUB_LANE_COMPANY_KEYS) {
    if (k in o && Array.isArray(o[k])) {
      companyRaw = o[k] as unknown[];
      break;
    }
  }
  if (!companyRaw || !isCompanyListArray(companyRaw)) return null;

  const info: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if ((SUB_LANE_COMPANY_KEYS as readonly string[]).includes(k)) continue;
    if (COMPANY_INFO_KEYS.includes(k)) {
      Object.assign(info, parseInfoRecord(v));
      continue;
    }
    const text = stringifyInfoValue(v);
    if (text) info[String(k).trim()] = text;
  }

  return {
    info,
    companies: companyRaw
      .map((x) => parseCompanyListItem(x))
      .filter(Boolean) as CompanyListDraft[],
  };
}

/** 是否为「子泳道名 → 公司列表」或「子泳道名 → { 元数据, 公司: [...] }」映射 */
function isNestedSubLaneMap(val: unknown): boolean {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const entries = Object.entries(val as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(([, v]) => parseSubLaneBlock(v) != null);
}

const TAXONOMY_META_KEYS = new Set(['version', 'name', 'description', 'lanes']);

function taxonomyContentEntries(record: Record<string, unknown>): [string, unknown][] {
  return Object.entries(record).filter(([k]) => !TAXONOMY_META_KEYS.has(k));
}

/** 判断根对象写法：扁平类别 / 嵌套子泳道 / 无效或混写 */
function classifyTopLevelRecord(record: Record<string, unknown>): 'flat' | 'nested' | 'invalid' {
  const entries = taxonomyContentEntries(record);
  if (entries.length === 0) return 'invalid';

  let sawFlat = false;
  let sawNested = false;
  for (const [, v] of entries) {
    if (isCompanyListArray(v)) {
      sawFlat = true;
      continue;
    }
    if (isNestedSubLaneMap(v)) {
      sawNested = true;
      continue;
    }
    return 'invalid';
  }
  if (sawFlat && sawNested) return 'invalid';
  if (sawNested) return 'nested';
  if (sawFlat) return 'flat';
  return 'invalid';
}

const DEFAULT_TIER_CYCLE: AISegmentTier[] = ['Upstream', 'Upstream', 'Midstream', 'Midstream', 'Downstream'];

/** 根泳道名含「上游_/中游_/下游_」时优先映射 tier，否则按根序号循环 */
function tierFromRootTitle(title: string, rootIdx: number): AISegmentTier {
  const t = title.trim();
  if (t.startsWith('上游_') || t.startsWith('上游')) return 'Upstream';
  if (t.startsWith('中游_') || t.startsWith('中游')) return 'Midstream';
  if (t.startsWith('下游_') || t.startsWith('下游')) return 'Downstream';
  return DEFAULT_TIER_CYCLE[rootIdx % DEFAULT_TIER_CYCLE.length];
}

function buildCompanyNodes(
  drafts: CompanyListDraft[],
  idPrefix: string,
  nameToId: Map<string, string>,
): AICompanyNode[] {
  return drafts.map((d, j) => {
    const id = `${idPrefix}-${j}`;
    const relations: AICompanyRelation[] = d.links
      .map((link) => {
        const targetId = nameToId.get(link.targetName);
        if (!targetId || targetId === id) return null;
        return { target_id: targetId, relation_zh: link.relation_zh || '上下游' };
      })
      .filter(Boolean) as AICompanyRelation[];
    const info = { ...d.info };
    if (d.ts_code) info.ts_code = d.ts_code;
    return {
      id,
      name: d.name,
      relations,
      ...(Object.keys(info).length > 0 ? { info } : {}),
      ...(d.ts_code ? { ts_code: d.ts_code } : {}),
    };
  });
}

function registerCompanyIds(drafts: CompanyListDraft[], idPrefix: string, nameToId: Map<string, string>) {
  drafts.forEach((d, j) => {
    nameToId.set(d.name, `${idPrefix}-${j}`);
  });
}

/** 「根泳道 → 子泳道 → 公司列表」两层嵌套 YAML */
function lanesFromNestedCategoryMap(record: Record<string, unknown>): AIRootLane[] {
  const rootEntries = taxonomyContentEntries(record);
  if (rootEntries.length === 0) {
    throw new Error('产业链 taxonomy YAML: 嵌套结构至少须有一个根泳道');
  }

  type SubDraft = {
    rootIdx: number;
    subIdx: number;
    title: string;
    info: Record<string, string>;
    companies: CompanyListDraft[];
  };
  const subDrafts: SubDraft[] = [];

  rootEntries.forEach(([rootTitleRaw, subMap], rootIdx) => {
    if (!isNestedSubLaneMap(subMap)) {
      throw new Error(
        `产业链 taxonomy YAML: 根泳道「${String(rootTitleRaw).trim()}」下须为「子泳道: [公司……]」或「子泳道: { 产业位置…, 公司: [……] }」结构`,
      );
    }
    Object.entries(subMap as Record<string, unknown>).forEach(([subTitleRaw, block], subIdx) => {
      const parsed = parseSubLaneBlock(block);
      if (!parsed) {
        throw new Error(`产业链 taxonomy YAML: 子泳道「${String(subTitleRaw).trim()}」格式无效`);
      }
      subDrafts.push({
        rootIdx,
        subIdx,
        title: String(subTitleRaw).trim(),
        info: parsed.info,
        companies: parsed.companies,
      });
    });
  });

  const nameToId = new Map<string, string>();
  for (const sd of subDrafts) {
    registerCompanyIds(sd.companies, `co-${sd.rootIdx}-${sd.subIdx}`, nameToId);
  }

  return rootEntries.map(([rootTitleRaw], rootIdx) => {
    const subs = subDrafts.filter((s) => s.rootIdx === rootIdx);
    return {
      id: `lane-${rootIdx}`,
      title: String(rootTitleRaw).trim(),
      tier: tierFromRootTitle(String(rootTitleRaw).trim(), rootIdx),
      sub_lanes: subs.map((sd) => ({
        id: `sub-${sd.rootIdx}-${sd.subIdx}`,
        title: sd.title,
        companies: buildCompanyNodes(sd.companies, `co-${sd.rootIdx}-${sd.subIdx}`, nameToId),
        ...(Object.keys(sd.info).length > 0 ? { info: sd.info } : {}),
      })),
    };
  });
}

/** 由 taxonomy 生成 React Flow 连线（source → 关联公司） */
export function buildFlowEdgesFromTaxonomy(
  tax: AIIndustryTaxonomyFile,
  nodeIdPrefix: string,
): {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  label?: string;
  labelStyle?: { fontSize: number; fill: string };
}[] {
  const edges: {
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
    label?: string;
    labelStyle?: { fontSize: number; fill: string };
  }[] = [];
  let n = 0;
  for (const lane of tax.lanes) {
    for (const sub of lane.sub_lanes) {
      for (const c of sub.companies) {
        const source = `${nodeIdPrefix}-${c.id}`;
        for (const r of c.relations ?? []) {
          if (!r?.target_id) continue;
          const target = `${nodeIdPrefix}-${r.target_id}`;
          edges.push({
            id: `e-rel-${n++}`,
            source,
            target,
            sourceHandle: 'bottom',
            targetHandle: 'top',
            label: r.relation_zh || '上下游',
            labelStyle: { fontSize: 10, fill: '#64748b' },
          });
        }
      }
    }
  }
  return edges;
}

/** 「类别 → 公司列表」YAML；公司下一级列表为关联公司（上下游连线） */
function lanesFromCategoryCompanyMap(record: Record<string, unknown>): AIRootLane[] {
  const entries = taxonomyContentEntries(record).filter(([, v]) => isCompanyListArray(v)) as [
    string,
    unknown[],
  ][];

  if (entries.length === 0) {
    throw new Error('产业链 taxonomy YAML: 须提供「类别: [公司……]」、两层嵌套或 lanes 结构');
  }

  type LaneDraft = { title: string; laneIdx: number; companies: CompanyListDraft[] };
  const laneDrafts: LaneDraft[] = entries.map(([titleRaw, arr], laneIdx) => ({
    title: String(titleRaw).trim(),
    laneIdx,
    companies: (arr as unknown[])
      .map((x) => parseCompanyListItem(x))
      .filter(Boolean) as CompanyListDraft[],
  }));

  const nameToId = new Map<string, string>();
  for (const ld of laneDrafts) {
    registerCompanyIds(ld.companies, `co-${ld.laneIdx}`, nameToId);
  }

  return laneDrafts.map((ld) => ({
    id: `lane-${ld.laneIdx}`,
    title: ld.title,
    tier: tierFromRootTitle(ld.title, ld.laneIdx),
    sub_lanes: [
      {
        id: `sub-${ld.laneIdx}`,
        title: ld.title,
        companies: buildCompanyNodes(ld.companies, `co-${ld.laneIdx}`, nameToId),
      },
    ],
  }));
}

/** 解析任意产业链 YAML：
 * - 根为字符串数组：仅类别名；
 * - 根为 `{ 类别: [公司……] }`：扁平泳道；
 * - 根为 `{ 根泳道: { 子泳道: [公司……] } }`：两层嵌套泳道；
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
      return resolveRelationsInTaxonomy(doc as AIIndustryTaxonomyFile);
    }
    const mode = classifyTopLevelRecord(maybe);
    if (mode === 'flat') {
      return resolveRelationsInTaxonomy({ version: '2.5.0', lanes: lanesFromCategoryCompanyMap(maybe) });
    }
    if (mode === 'nested') {
      return resolveRelationsInTaxonomy({ version: '3.0.0', lanes: lanesFromNestedCategoryMap(maybe) });
    }
    const entries = taxonomyContentEntries(maybe);
    if (entries.length === 0) {
      throw new Error('产业链 taxonomy YAML: 根对象为空，须提供 lanes 或泳道类别');
    }
    const hasFlat = entries.some(([, v]) => isCompanyListArray(v));
    const hasNested = entries.some(([, v]) => isNestedSubLaneMap(v));
    if (hasFlat && hasNested) {
      throw new Error('产业链 taxonomy YAML: 不能在同一文件中混用扁平类别与两层嵌套子泳道');
    }
    throw new Error(
      `产业链 taxonomy YAML: 键「${entries[0][0]}」的值须为公司数组，或「子泳道名: [公司……]」/「子泳道名: { 元数据, 公司: [……] }」嵌套对象`,
    );
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
