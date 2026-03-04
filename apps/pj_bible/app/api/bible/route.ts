import { NextRequest, NextResponse } from 'next/server';
import { getBible, type BibleVersion } from '@/lib/bible-data';

const VALID_VERSIONS: BibleVersion[] = ['cuvs', 'cuvt', 'niv'];

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const versionParam = searchParams.get('version') as BibleVersion | null;

  if (!versionParam || !VALID_VERSIONS.includes(versionParam)) {
    return NextResponse.json({ error: 'Invalid version' }, { status: 400 });
  }

  try {
    const bible = await getBible(versionParam);
    return NextResponse.json({ bible });
  } catch (err) {
    console.error('Error loading bible data', err);
    return NextResponse.json({ error: 'Failed to load bible data' }, { status: 500 });
  }
}

