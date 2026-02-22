import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="text-center py-16">
      <h1 className="text-4xl font-bold mb-4">404</h1>
      <p className="text-xl text-gray-600 mb-8">找不到此頁面</p>
      <Link
        href="/"
        className="text-blue-600 hover:text-blue-800 underline"
      >
        返回首頁
      </Link>
    </div>
  );
}
