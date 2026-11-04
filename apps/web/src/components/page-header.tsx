import type { ReactNode } from "react";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-8">
      <h1 className="text-[21px] leading-tight font-bold tracking-[-0.01em]">{title}</h1>
      {children && <p className="mt-2 max-w-[62ch] text-muted-foreground">{children}</p>}
    </header>
  );
}
