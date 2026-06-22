import { NextResponse } from 'next/server';

import { parseIndustryTaxonomyYaml } from '@/app/industryLink/aiIndustryTaxonomy';
import { COMPANY_NAME_TO_TS_CODE } from '@/app/industryLink/industryCompanyTsCodes';
import { listIndustryTaxonomies } from '@/app/industryLink/taxonomyRegistry.server';
import { queryIndustryPriceSnapshots } from '@/app/lib/industryPriceSnapshots.server';

export const dynamic = 'force-dynamic';

type TaxonomyUniverse = {
  codes: Set<string>;
  unmapped: number;
};

export async function GET() {
  try {
    const taxonomies = await listIndustryTaxonomies();
    const universes = new Map<string, TaxonomyUniverse>();
    const allCodes = new Set<string>();

    for (const item of taxonomies) {
      const parsed = parseIndustryTaxonomyYaml(item.content);
      const companyNames = new Set<string>();
      const universe: TaxonomyUniverse = { codes: new Set<string>(), unmapped: 0 };

      for (const lane of parsed.lanes) {
        for (const subLane of lane.sub_lanes) {
          for (const company of subLane.companies) {
            const name = company.name.trim();
            if (!name || companyNames.has(name)) continue;
            companyNames.add(name);
            const code = String(company.ts_code ?? COMPANY_NAME_TO_TS_CODE[name] ?? '').trim().toUpperCase();
            if (!code) {
              universe.unmapped += 1;
              continue;
            }
            universe.codes.add(code);
            allCodes.add(code);
          }
        }
      }
      universes.set(item.id, universe);
    }

    const snapshots = await queryIndustryPriceSnapshots(allCodes);
    const snapshotByCode = new Map(snapshots.map((row) => [row.ts_code, row]));
    const tradeDate = snapshots.reduce(
      (latest, row) => row.trade_date > latest ? row.trade_date : latest,
      '',
    );

    const rows: Record<string, {
      up: number;
      down: number;
      flat: number;
      missing: number;
      total: number;
    }> = {};

    for (const item of taxonomies) {
      const universe = universes.get(item.id) ?? { codes: new Set<string>(), unmapped: 0 };
      let up = 0;
      let down = 0;
      let flat = 0;
      let missing = universe.unmapped;

      for (const code of universe.codes) {
        const snapshot = snapshotByCode.get(code);
        if (!snapshot || !tradeDate || snapshot.trade_date !== tradeDate || snapshot.d1 == null) {
          missing += 1;
        } else if (snapshot.d1 > 0) {
          up += 1;
        } else if (snapshot.d1 < 0) {
          down += 1;
        } else {
          flat += 1;
        }
      }

      rows[item.id] = {
        up,
        down,
        flat,
        missing,
        total: universe.codes.size + universe.unmapped,
      };
    }

    return NextResponse.json({ trade_date: tradeDate, rows });
  } catch (error) {
    console.error('[industry-link/market-breadth] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to query industry market breadth',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
