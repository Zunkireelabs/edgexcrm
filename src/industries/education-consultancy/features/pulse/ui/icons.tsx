import { Archive, ArrowRight, ChevronDown, ChevronRight, CircleAlert, Clock, Sparkles, TrendingDown, TrendingUp, X } from "lucide-react";
import type { AttentionIcon } from "../lib/types";

/** Mockup icon sizing comes from `.pulse svg.i` (16px, 1.75 stroke) / `.s` (14px). */
export const Spark = ({ className = "i" }: { className?: string }) => <Sparkles className={className} aria-hidden />;
export const Chevron = ({ open }: { open?: boolean }) => (open ? <ChevronDown className="i" aria-hidden /> : <ChevronRight className="i" aria-hidden />);
export const Arrow = () => <ArrowRight className="i s" aria-hidden />;
export const Caret = () => <ChevronDown className="i s" aria-hidden />;

export function ItemIcon({ icon }: { icon: AttentionIcon | "down" | "up" | "archive" }) {
  const C = { down: TrendingDown, up: TrendingUp, clock: Clock, alert: CircleAlert, archive: Archive }[icon];
  return <C className="i" aria-hidden />;
}
export const XClose = () => <X className="i" aria-hidden />;
