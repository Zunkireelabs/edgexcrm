// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DateTimePicker, TimeOfDayPicker } from "./time-of-day-picker";

vi.mock("@/components/ui/select", async () => await import("./test-select-mock"));

afterEach(cleanup);

describe("TimeOfDayPicker", () => {
  it("shows a 24-hour value as hour, minute and AM / PM", () => {
    render(<TimeOfDayPicker value="15:30" onChange={() => {}} ariaLabel="T" />);
    expect(screen.getByLabelText("T — hour")).toHaveValue("3");
    expect(screen.getByLabelText("T — minute")).toHaveValue("30");
    expect(screen.getByLabelText("T — AM or PM")).toHaveValue("PM");
  });

  it("emits 24-hour values: picking PM moves 10:00 AM to 22:00, noon and midnight are right", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TimeOfDayPicker value="10:00" onChange={onChange} ariaLabel="T" />);
    fireEvent.change(screen.getByLabelText("T — AM or PM"), { target: { value: "PM" } });
    expect(onChange).toHaveBeenLastCalledWith("22:00");

    rerender(<TimeOfDayPicker value="10:00" onChange={onChange} ariaLabel="T" />);
    fireEvent.change(screen.getByLabelText("T — hour"), { target: { value: "12" } });
    expect(onChange).toHaveBeenLastCalledWith("00:00"); // 12 AM

    rerender(<TimeOfDayPicker value="22:00" onChange={onChange} ariaLabel="T" />);
    fireEvent.change(screen.getByLabelText("T — hour"), { target: { value: "12" } });
    expect(onChange).toHaveBeenLastCalledWith("12:00"); // 12 PM
  });

  it("with allowEmpty: starts blank, picking an hour fills it, the dash clears it", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TimeOfDayPicker value="" onChange={onChange} allowEmpty ariaLabel="T" />);
    expect(screen.getByLabelText("T — minute")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("T — hour"), { target: { value: "9" } });
    expect(onChange).toHaveBeenLastCalledWith("09:00");

    rerender(<TimeOfDayPicker value="09:00" onChange={onChange} allowEmpty ariaLabel="T" />);
    fireEvent.change(screen.getByLabelText("T — hour"), { target: { value: "none" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("keeps a minute that is not on the 5-minute grid instead of changing it", () => {
    render(<TimeOfDayPicker value="10:07" onChange={() => {}} ariaLabel="T" />);
    expect(screen.getByLabelText("T — minute")).toHaveValue("7");
  });
});

describe("DateTimePicker", () => {
  it("combines the date with the 12-hour time into YYYY-MM-DDTHH:mm", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-10-05T09:00" onChange={onChange} ariaLabel="S" />);
    fireEvent.change(screen.getByLabelText("S — AM or PM"), { target: { value: "PM" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-05T21:00");
    fireEvent.change(screen.getByLabelText("S — date"), { target: { value: "2026-10-06" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-06T09:00");
  });
});
