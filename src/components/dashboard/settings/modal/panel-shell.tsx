"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PanelHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="border-b border-gray-100 pb-4 mb-6">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {description && (
        <p className="text-sm text-gray-500 mt-0.5">{description}</p>
      )}
    </div>
  );
}

export function PanelSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      {children}
    </section>
  );
}

export function PanelContent({ children }: { children: ReactNode }) {
  return (
    <div className="px-8 py-6 space-y-6 h-full overflow-y-auto">
      {children}
    </div>
  );
}
