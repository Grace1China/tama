import { redirect } from 'next/navigation';

const DEFAULT_VERSION = 'cuvs';

export default async function ChapterRedirect({
  params,
}: {
  params: { bookId: string; chapterId: string };
}) {
  redirect(`/book/${params.bookId}/${params.chapterId}/${DEFAULT_VERSION}`);
}
