import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

type MetaRow = {
  name: string;
  type: string;
  defaultShow: boolean;
  desc: string;
};

function parseTsv(content: string): MetaRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 1) return [];
  // header: 名称\t类型\t默认显示\t描述
  const rows: MetaRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    const name = String(parts[0] ?? '').trim();
    if (!name) continue;
    const type = String(parts[1] ?? '').trim();
    const defaultShowRaw = String(parts[2] ?? '').trim().toUpperCase();
    const desc = String(parts[3] ?? '').trim();
    rows.push({
      name,
      type,
      defaultShow: defaultShowRaw === 'Y',
      desc: desc || name,
    });
  }
  return rows;
}

export async function GET(_request: NextRequest) {
  try {
    const metaPath = path.join(process.cwd(), 'app/meta/fina_indicator_vip.csv');
    if (!fs.existsSync(metaPath)) {
      return NextResponse.json(
        { error: 'Meta file not found', path: metaPath },
        { status: 404 }
      );
    }
    const content = fs.readFileSync(metaPath, 'utf-8');
    const rows = parseTsv(content);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to read meta', message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

