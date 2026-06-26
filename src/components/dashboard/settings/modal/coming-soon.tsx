"use client";

import { Sparkles } from "lucide-react";

export function ComingSoon({ feature }: { feature: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <Sparkles className="w-5 h-5 text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-900">{feature}</p>
      <p className="text-xs text-gray-400 mt-1">Coming soon</p>
    </div>
  );
}
