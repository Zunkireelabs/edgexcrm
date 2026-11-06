import { ChevronDown } from "lucide-react";

/** The mockup's ".dd" dropdown: bordered 10px pill + chevron. Native <select> (no Radix ids → no SSR hydration mismatch). */
export function FieldSelect({
  value, onChange, label, icon, children,
}: { value: string; onChange: (v: string) => void; label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex items-center rounded-[10px] border border-[#e5e7eb] bg-white text-[#171717]">
      {icon && <span className="pointer-events-none absolute left-3 flex items-center text-[#6b7280]" aria-hidden>{icon}</span>}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
        className={`appearance-none bg-transparent py-[7px] pr-8 outline-none ${icon ? "pl-[34px]" : "pl-3"}`}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-[15px] w-[15px]" aria-hidden />
    </span>
  );
}
