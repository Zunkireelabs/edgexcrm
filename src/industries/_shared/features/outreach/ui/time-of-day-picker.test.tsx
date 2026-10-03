// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/ui/select", async () => await import("./test-select-mock"));

import { DateTimePicker, TimeOfDayPicker } from "./time-of-day-picker";

afterEach(cleanup);

const optionTexts = (el: HTMLElement) => Array.from(el.querySelectorAll("option")).map((o) => o.textContent);

describe("TimeOfDayPicker", () => {
  it("is one list of readable times with AM / PM, in half-hour steps", () => {
    render(<TimeOfDayPicker value="15:30" onChange={() => {}} ariaLabel="T" />);
    const select = screen.getByLabelText("T") as HTMLSelectElement;
    expect(select).toHaveValue("15:30");
    const texts = optionTexts(select);
    expect(texts).toHaveLength(48);
    expect(texts.slice(0, 3)).toEqual(["12:00 AM", "12:30 AM", "1:00 AM"]);
    expect(texts).toContain("12:00 PM");
    expect(texts).toContain("3:30 PM");
    expect(texts.at(-1)).toBe("11:30 PM");
  });

  it("emits the 24-hour value of the time picked", () => {
    const onChange = vi.fn();
    render(<TimeOfDayPicker value="10:00" onChange={onChange} ariaLabel="T" />);
    fireEvent.change(screen.getByLabelText("T"), { target: { value: "15:00" } });
    expect(onChange).toHaveBeenLastCalledWith("15:00");
    fireEvent.change(screen.getByLabelText("T"), { target: { value: "00:00" } });
    expect(onChange).toHaveBeenLastCalledWith("00:00");
  });

  it("with allowEmpty: starts blank with the empty entry, which clears the value", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TimeOfDayPicker value="" onChange={onChange} allowEmpty emptyLabel="Window time" ariaLabel="T" />);
    expect(screen.getByLabelText("T")).toHaveValue("none");
    expect(optionTexts(screen.getByLabelText("T"))[0]).toBe("Window time");

    rerender(<TimeOfDayPicker value="09:00" onChange={onChange} allowEmpty emptyLabel="Window time" ariaLabel="T" />);
    fireEvent.change(screen.getByLabelText("T"), { target: { value: "none" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("keeps a saved time that is not on the half-hour grid instead of changing it", () => {
    render(<TimeOfDayPicker value="10:15" onChange={() => {}} ariaLabel="T" />);
    const select = screen.getByLabelText("T");
    expect(select).toHaveValue("10:15");
    expect(optionTexts(select)).toContain("10:15 AM");
  });
});

describe("DateTimePicker", () => {
  it("combines the date with the picked time into YYYY-MM-DDTHH:mm", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-10-05T09:00" onChange={onChange} ariaLabel="S" />);
    fireEvent.change(screen.getByLabelText("S — time"), { target: { value: "21:00" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-05T21:00");
    fireEvent.change(screen.getByLabelText("S — date"), { target: { value: "2026-10-06" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-06T09:00");
  });
});
