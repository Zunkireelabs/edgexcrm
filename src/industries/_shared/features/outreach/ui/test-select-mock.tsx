// Test helper: stands in for the Radix Select (needs pointer events jsdom lacks) with a native <select>. It keeps the
// trigger's aria-label so tests can find each dropdown by name. Use via:
//   vi.mock("@/components/ui/select", async () => await import("./test-select-mock"));
import * as React from "react";

type TriggerProps = { "aria-label"?: string; id?: string };

export function SelectTrigger(_props: TriggerProps & { className?: string; children?: React.ReactNode }) {
  void _props;
  return null;
}
export const SelectValue = () => null;
export const SelectContent = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const SelectItem = ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>;

export function Select({
  value,
  onValueChange,
  disabled,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  let label: string | undefined;
  let id: string | undefined;
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === SelectTrigger) {
      const p = child.props as TriggerProps;
      label = p["aria-label"];
      id = p.id;
    }
  });
  return (
    <select id={id} aria-label={label} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  );
}
