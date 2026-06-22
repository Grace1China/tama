import fs from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_CODES = 240;
const LATEST_PATH = path.join(process.cwd(), 'app/industryLink/auction/latest.json');

type AuctionSnapshot = {
  ts_code?: unknown;
  snapshot_at?: unknown;
  received_at?: unknown;
  last_price?: unknown;
  pre_close?: unknown;
  pct_chg?: unknown;
  volume?: unknown;
  amount?: unknown;
  source?: unknown;
  status?: unknown;
};

function cleanTsCodes(raw: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const part of raw.split(',')) {
    const code = part.trim().toUpperCase();
    if (!/^\d{6}\.(SZ|SH|BJ)$/.test(code)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= MAX_CODES) break;
  }
  return codes;
}

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest) {
  try {
    const tsCodes = cleanTsCodes(String(request.nextUrl.searchParams.get('ts_codes') ?? ''));
    if (tsCodes.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    let raw: string;
    try {
      raw = await fs.readFile(LATEST_PATH, 'utf-8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return NextResponse.json({ rows: [], missing: true });
      throw error;
    }

    const data = JSON.parse(raw) as Record<string, AuctionSnapshot>;
    const rows = tsCodes
      .map((code) => {
        const row = data[code];
        if (!row) return null;
        return {
          ts_code: code,
          snapshot_at: String(row.snapshot_at ?? ''),
          received_at: String(row.received_at ?? ''),
          last_price: finiteOrNull(row.last_price),
          pre_close: finiteOrNull(row.pre_close),
          pct_chg: finiteOrNull(row.pct_chg),
          volume: finiteOrNull(row.volume),
          amount: finiteOrNull(row.amount),
          source: String(row.source ?? 'myquant'),
          status: String(row.status ?? 'unknown'),
        };
      })
      .filter(Boolean);

    return NextResponse.json({ rows });
  } catch (error) {
    console.error('[industry-link/auction-snapshots] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to read auction snapshots',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
