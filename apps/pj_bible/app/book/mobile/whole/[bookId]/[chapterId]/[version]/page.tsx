import type { BibleVersion } from '@/lib/bible-data';
import WholeBookMobileClient from '@/components/WholeBookMobileClient';
import { notFound } from 'next/navigation';

const VALID_VERSIONS: BibleVersion[] = ['cuvs', 'cuvt', 'niv'];

function parseVersion(v: string | undefined): BibleVersion | null {
  if (v && VALID_VERSIONS.includes(v as BibleVersion)) return v as BibleVersion;
  return null;
}

/** 按需渲染；与 /book/whole/... 等价数据，版面为单列纵向滚动（无 CSS columns 横向翻页）。 */
export const dynamic = 'force-dynamic';

export default async function WholeBookMobilePage({
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
    <WholeBookMobileClient
      bookId={params.bookId}
      startChapterId={startChapterId}
      version={version}
    />
  );
}
