import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

const BASE = 'temp/tuShare';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const rel = request.nextUrl.searchParams.get('path');
    if (!rel || rel.includes('..') || path.isAbsolute(rel) || !rel.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    const filePath = path.join(process.cwd(), BASE, rel);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse(content, {
      header: true,
      skipEmptyLines: true,
    });
    const headers = (parsed.meta?.fields || []) as string[];
    const data = (parsed.data || []) as Record<string, unknown>[];
    return NextResponse.json({
      filename: path.basename(filePath),
      headers,
      originalHeaders: headers,
      data,
      totalRows: data.length,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read CSV' },
      { status: 500 }
    );
  }
}
