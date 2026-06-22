import { parseIndustryTaxonomyYaml, type AIIndustryTaxonomyFile } from './aiIndustryTaxonomy';
import { tsCodeForCompanyName } from './industryCompanyTsCodes';

/** 产业链企业在对比页展示的上下文 */
export type ChainCompanyContext = {
  subLaneTitle: string;
  subLaneCertainty?: string;
  subLaneElasticity?: string;
  companyCertainty?: string;
  companyElasticity?: string;
};

export type ChainContextMaps = {
  byTsCode: Record<string, ChainCompanyContext>;
  byCompanyName: Record<string, ChainCompanyContext>;
};

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

function buildContext(
  subTitle: string,
  subInfo: Record<string, string> | undefined,
  companyInfo: Record<string, string>,
): ChainCompanyContext {
  return {
    subLaneTitle: subTitle,
    subLaneCertainty: subInfo?.确定性?.trim() || undefined,
    subLaneElasticity: subInfo?.弹性?.trim() || undefined,
    companyCertainty: companyInfo.确定性?.trim() || undefined,
    companyElasticity: companyInfo.弹性?.trim() || undefined,
  };
}

/** 从产业链 taxonomy 提取对比页输入 token 与企业上下文映射 */
export function extractChainCompaniesFromTaxonomy(tax: AIIndustryTaxonomyFile): {
  inputTokens: string[];
  contextByTsCode: Record<string, ChainCompanyContext>;
  contextByCompanyName: Record<string, ChainCompanyContext>;
} {
  const inputTokens: string[] = [];
  const seenTokens = new Set<string>();
  const contextByTsCode: Record<string, ChainCompanyContext> = {};
  const contextByCompanyName: Record<string, ChainCompanyContext> = {};

  const pushToken = (token: string) => {
    const t = token.trim();
    if (!t || seenTokens.has(t)) return;
    seenTokens.add(t);
    inputTokens.push(t);
  };

  for (const lane of tax.lanes) {
    for (const sub of lane.sub_lanes) {
      for (const c of sub.companies) {
        const info = c.info ?? {};
        const ctx = buildContext(sub.title, sub.info, info);
        const tsCode = tsCodeFromCompanyInfo(info, c.ts_code, c.name);
        if (tsCode) {
          contextByTsCode[tsCode.toUpperCase()] = ctx;
          pushToken(tsCode);
        } else {
          contextByCompanyName[c.name.trim()] = ctx;
          pushToken(c.name);
        }
      }
    }
  }

  return { inputTokens, contextByTsCode, contextByCompanyName };
}

export function parseTaxonomyYamlContent(raw: string): AIIndustryTaxonomyFile {
  return parseIndustryTaxonomyYaml(raw);
}

/** 按 ts_code 或股票名称查找产业链上下文 */
export function lookupChainContext(
  code: string,
  stockName: string | undefined,
  maps: ChainContextMaps | null | undefined,
): ChainCompanyContext | undefined {
  if (!maps) return undefined;
  const up = code.trim().toUpperCase();
  if (maps.byTsCode[up]) return maps.byTsCode[up];
  const name = String(stockName ?? '').trim();
  if (name && maps.byCompanyName[name]) return maps.byCompanyName[name];
  return undefined;
}

/** 子泳道 deep link URL 携带的产业链上下文 */
export type SubLaneDeepLinkContext = {
  lane: string;
  subCertainty?: string;
  subElasticity?: string;
  coCtxRaw?: string;
};

/** 解析 coCtx=token~确定性~弹性,token2~... */
export function parseCoCtxParam(
  raw: string | null | undefined,
): Record<string, { certainty?: string; elasticity?: string }> {
  const out: Record<string, { certainty?: string; elasticity?: string }> = {};
  if (!raw?.trim()) return out;
  for (const part of raw.split(',')) {
    const [token, certainty, elasticity] = part.split('~');
    const t = String(token ?? '').trim();
    if (!t) continue;
    const entry = {
      certainty: certainty?.trim() || undefined,
      elasticity: elasticity?.trim() || undefined,
    };
    out[t] = entry;
    if (/^\d{6}\.(SZ|SH|BJ)$/i.test(t)) {
      out[t.toUpperCase()] = entry;
    }
  }
  return out;
}

/** 从子泳道 deep link 参数构建对比页 chainContextMaps */
export function buildChainContextMapsFromSubLaneLink(
  ctx: SubLaneDeepLinkContext,
  codes: string[],
  stockListRows?: { ts_code?: string; name?: string }[] | null,
): ChainContextMaps {
  const coByToken = parseCoCtxParam(ctx.coCtxRaw);
  const nameByCode = new Map<string, string>();
  for (const r of stockListRows ?? []) {
    const c = String(r.ts_code ?? '').trim().toUpperCase();
    const n = String(r.name ?? '').trim();
    if (c && n) nameByCode.set(c, n);
  }

  const byTsCode: Record<string, ChainCompanyContext> = {};
  const byCompanyName: Record<string, ChainCompanyContext> = {};

  for (const code of codes) {
    const up = code.trim().toUpperCase();
    const name = nameByCode.get(up);
    const co = coByToken[up] ?? coByToken[code] ?? (name ? coByToken[name] : undefined);
    const chainCtx: ChainCompanyContext = {
      subLaneTitle: ctx.lane,
      subLaneCertainty: ctx.subCertainty,
      subLaneElasticity: ctx.subElasticity,
      companyCertainty: co?.certainty,
      companyElasticity: co?.elasticity,
    };
    byTsCode[up] = chainCtx;
    if (name) byCompanyName[name] = chainCtx;
  }

  return { byTsCode, byCompanyName };
}
