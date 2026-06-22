import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeTsCodes,
  queryIndustryPriceSnapshots,
} from '@/app/lib/industryPriceSnapshots.server';

export const dynamic = 'force-dynamic';

const MAX_CODES = 240;

function cleanTsCodes(raw: string): string[] {
  return normalizeTsCodes(raw.split(','), MAX_CODES);
}

export async function GET(request: NextRequest) {
  try {
    const tsCodes = cleanTsCodes(String(request.nextUrl.searchParams.get('ts_codes') ?? ''));
    if (tsCodes.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    const rows = await queryIndustryPriceSnapshots(tsCodes);
    return NextResponse.json({
      rows: rows.map((r) => ({
        ts_code: r.ts_code,
        trade_date: r.trade_date,
        close: r.close,
        returns: {
          d1: r.d1,
          d5: r.d5,
          d20: r.d20,
          d60: r.d60,
        },
      })),
    });
  } catch (error) {
    console.error('[industry-link/price-snapshots] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to query price snapshots',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
