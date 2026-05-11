import type { PInfo3085Json } from '@/lib/cninfo/fetchPInfo3085Server';

/** 与年报 / 季报 / 中报等定期报告相关的标题关键词（巨潮 F002V） */
const PERIOD_TITLE_RE =
  /年报|年度报告|季报|季度报告|中报|半年度报告|半年报|一季报|二季报|三季报|四季报|半年报全文|季报全文/;

export function isPeriodicReportTitle(title: string): boolean {
  return PERIOD_TITLE_RE.test(String(title ?? '').trim());
}

export function pickPeriodicDisclosureLines(records: PInfo3085Json['records'], maxLines: number): string[] {
  const list = Array.isArray(records) ? records : [];
  const scored = list
    .map((r) => {
      const title = String(r?.F002V ?? '').trim();
      const date = String(r?.F001D ?? '').trim();
      if (!title || !isPeriodicReportTitle(title)) return null;
      const t = Date.parse(date.replace(/-/g, '/'));
      const sortKey = Number.isFinite(t) ? t : 0;
      return { sortKey, line: `${date || '—'}\t${title}` };
    })
    .filter((x): x is { sortKey: number; line: string } => x != null);
  scored.sort((a, b) => b.sortKey - a.sortKey);
  return scored.slice(0, maxLines).map((s) => s.line);
}

export function buildHotConceptsUserPrompt(tsCode: string, lines: string[]): string {
  const body = lines.length ? lines.map((l) => `- ${l}`).join('\n') : '（无匹配的定期报告类公告标题）';
  return `证券代码：${tsCode}

以下为该公司在巨潮资讯中披露的、与年报/季报/中报等定期报告相关的公告标题（按时间从新到旧，仅标题文本）：

${body}

请根据上述标题，归纳该公司业务或叙事中可能涉及的市场热点概念（例如：CPO、万卡集群、算力、光模块、AI 应用、国产化替代等；具体词组依标题实际内容而定）。

输出要求（必须严格遵守）：
1. 只输出一行中文；不要引用句；不要编号；不要用 Markdown。
2. 若可归纳，用顿号「、」连接 3～8 个简短词组（每个一般 2～8 个字）。
3. 若标题信息不足以判断任何热点概念，只输出：暂无明确热点`;
}

export function buildHotConceptsSystemPrompt(): string {
  return '你是面向 A 股投资者的助理，擅长从公告标题中提炼当下市场关心的概念关键词。';
}
