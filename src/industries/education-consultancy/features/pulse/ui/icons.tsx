import {
  ArchiveIcon,
  ArrowRightIcon,
  CaretDownIcon,
  CaretRightIcon,
  WarningCircleIcon,
  ClockIcon,
  SparkleIcon,
  TrendDownIcon,
  TrendUpIcon,
  XIcon,
} from "@/components/icons";
import type { AttentionIcon } from "../lib/types";

/** Mockup icon sizing comes from `.pulse svg.i` (16px, 1.75 stroke) / `.s` (14px). */
export const Spark = ({ className = "i" }: { className?: string }) => <SparkleIcon className={className} aria-hidden />;
export const Chevron = ({ open }: { open?: boolean }) => (open ? <CaretDownIcon className="i" aria-hidden /> : <CaretRightIcon className="i" aria-hidden />);
export const Arrow = () => <ArrowRightIcon className="i s" aria-hidden />;
export const Caret = () => <CaretDownIcon className="i s" aria-hidden />;

export function ItemIcon({ icon }: { icon: AttentionIcon | "down" | "up" | "archive" }) {
  const C = { down: TrendDownIcon, up: TrendUpIcon, clock: ClockIcon, alert: WarningCircleIcon, archive: ArchiveIcon }[icon];
  return <C className="i" aria-hidden />;
}
export const XClose = () => <XIcon className="i" aria-hidden />;
