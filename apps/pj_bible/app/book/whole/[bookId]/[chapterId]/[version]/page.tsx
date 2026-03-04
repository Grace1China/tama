import type { BibleVersion } from '@/lib/bible-data';
import WholeBookClient from '@/components/WholeBookClient';
import { notFound } from 'next/navigation';

const VALID_VERSIONS: BibleVersion[] = ['cuvs', 'cuvt', 'niv'];

function parseVersion(v: string | undefined): BibleVersion | null {
  if (v && VALID_VERSIONS.includes(v as BibleVersion)) return v as BibleVersion;
  return null;
}

/** 按需渲染，避免 build 时预渲染所有「书×章×版本」组合导致路径爆炸 */
export const dynamic = 'force-dynamic';

export default async function WholeBookPage({
  params,
}: {
  params: { bookId: string; chapterId: string; version: string };
}) {
  const version = parseVersion(params.version);
  if (!version) {
    notFound();
  }
  const startChapterId = parseInt(params.chapterId, 10);

  return (
    <WholeBookClient
      bookId={params.bookId}
      startChapterId={startChapterId}
      version={version}
    />
  );
}
