// @vitest-environment jsdom
//
// SendWindowEditor — "When emails go out". Pins: off by default for a sequence with no window; turning it on starts
// from the tenant's default window; days toggle but the last one can't be switched off; changes are reported whole;
// turning it off reports null (= send as soon as due).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

vi.mock("@/components/ui/select", async () => await import("./test-select-mock"));

import { SendWindowEditor } from "./send-window-editor";
import type { SendWindow } from "../lib/send-window";

afterEach(cleanup);

const tenantDefault: SendWindow = { time: "10:00", days: [0, 1, 2, 3, 4, 5], timezone_mode: "lead", spread_minutes: 120 };
const current: SendWindow = { time: "10:00", days: [1, 2, 3, 4, 5], timezone_mode: "lead", spread_minutes: 120 };

describe("SendWindowEditor", () => {
  it("no window: shows only the switch (off); turning it on starts from the tenant's default window", () => {
    const onChange = vi.fn();
    render(<SendWindowEditor value={null} onChange={onChange} defaultWindow={tenantDefault} officeTimeZone="Asia/Kathmandu" />);

    expect(screen.getByLabelText("Send at set times")).not.toBeChecked();
    expect(screen.queryByRole("group", { name: /Days emails may go out/ })).toBeNull();

    fireEvent.click(screen.getByLabelText("Send at set times"));
    expect(onChange).toHaveBeenCalledWith(tenantDefault);
  });

  it("on: shows the days, a plain-words summary and the timezone note", () => {
    render(<SendWindowEditor value={current} onChange={() => {}} officeTimeZone="Asia/Kathmandu" />);
    expect(screen.getByLabelText("Send at set times")).toBeChecked();
    expect(screen.getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/Emails go out Mon, Tue, Wed, Thu, Fri at 10:00 AM–12:00 PM, in the lead's timezone/)).toBeInTheDocument();
    expect(screen.getByText(/office's timezone \(Asia\/Kathmandu\) is used/)).toBeInTheDocument();
  });

  it("toggling a day reports the whole window with the day added / removed (sorted)", () => {
    const onChange = vi.fn();
    render(<SendWindowEditor value={current} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Sun" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...current, days: [0, 1, 2, 3, 4, 5] });
    fireEvent.click(screen.getByRole("button", { name: "Wed" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...current, days: [1, 2, 4, 5] });
  });

  it("the last remaining day can't be switched off", () => {
    const onChange = vi.fn();
    render(<SendWindowEditor value={{ ...current, days: [3] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Wed" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("changing the time, release spread and timezone each report the whole window", () => {
    const onChange = vi.fn();
    const { container } = render(<SendWindowEditor value={current} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Send window start"), { target: { value: "15:30" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...current, time: "15:30" });

    // the first three selects are the time picker (hour, minute, AM/PM)
    const spread = screen.getByLabelText("Release") as HTMLSelectElement;
    const tz = container.querySelector("#seq-window-tz") as HTMLSelectElement;
    fireEvent.change(spread, { target: { value: "240" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...current, spread_minutes: 240 });
    fireEvent.change(tz, { target: { value: "office" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...current, timezone_mode: "office" });
  });

  it("turning the switch off reports null (send as soon as due)", () => {
    const onChange = vi.fn();
    render(<SendWindowEditor value={current} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Send at set times"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
