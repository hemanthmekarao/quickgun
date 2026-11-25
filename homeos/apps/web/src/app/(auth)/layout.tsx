import type { ReactNode } from 'react';
import { Home } from 'lucide-react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-bg">
            <Home className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-xl font-semibold tracking-tight">HomeOS</span>
        </div>
        {children}
      </div>
    </main>
  );
}
