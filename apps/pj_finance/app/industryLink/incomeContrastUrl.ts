/** 产业链子泳道 → 利润对比页 deep link */
export type IncomeContrastCompanyContext = {
  token: string;
  certainty?: string;
  elasticity?: string;
};

export type IncomeContrastSubLaneOpts = {
  lane?: string;
  subCertainty?: string;
  subElasticity?: string;
  companyContexts?: IncomeContrastCompanyContext[];
};

export function buildIncomeContrastUrl(
  stocks: string[],
  opts?: string | IncomeContrastSubLaneOpts,
): string {
  const o: IncomeContrastSubLaneOpts =
    typeof opts === 'string' ? { lane: opts } : (opts ?? {});
  const tokens = stocks.map((s) => String(s).trim()).filter(Boolean);
  const qs = new URLSearchParams();
  qs.set('stocks', tokens.join(','));
  qs.set('auto', '1');
  qs.set('gridFull', '1');
  const laneLabel = String(o.lane ?? '').trim();
  if (laneLabel) qs.set('lane', laneLabel);
  const subCertainty = String(o.subCertainty ?? '').trim();
  if (subCertainty) qs.set('subCertainty', subCertainty);
  const subElasticity = String(o.subElasticity ?? '').trim();
  if (subElasticity) qs.set('subElasticity', subElasticity);
  if (o.companyContexts?.length) {
    const coCtx = o.companyContexts
      .map(({ token, certainty, elasticity }) =>
        [String(token).trim(), certainty ?? '', elasticity ?? ''].join('~'),
      )
      .filter((s) => s && !s.startsWith('~'))
      .join(',');
    if (coCtx) qs.set('coCtx', coCtx);
  }
  return `/incomeContrast?${qs.toString()}`;
}

/** 整条产业链 → 利润对比页（仅传 taxonomy，对比页自行解析全部企业） */
export function buildIncomeContrastChainUrl(taxonomyId: string, taxonomyLabel?: string): string {
  const qs = new URLSearchParams();
  qs.set('taxonomy', String(taxonomyId).trim());
  qs.set('auto', '1');
  const label = String(taxonomyLabel ?? '').trim();
  if (label) qs.set('lane', label);
  return `/incomeContrast?${qs.toString()}`;
}
