import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="text-sm text-muted">404</p>
        <h1 className="mt-1 text-xl font-semibold">This page does not exist</h1>
        <Link href="/dashboard" className="mt-4 inline-block text-sm underline">
          Go to the dashboard
        </Link>
      </div>
    </main>
  );
}
