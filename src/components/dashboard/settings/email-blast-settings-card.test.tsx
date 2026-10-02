// @vitest-environment jsdom
//
// EmailBlastSettingsCard — the admin surface for the recipient cap and (Phase 2c) the daily send limit. Pins:
// both limits show; an admin saving only the daily limit sends ONLY that field; out-of-range values are
// refused before any request; a non-admin sees read-only values and no Save.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), message: vi.fn() } }));

import { EmailBlastSettingsCard } from "./email-blast-settings-card";

let patchBodies: Record<string, unknown>[];

beforeEach(() => {
  patchBodies = [];
  toastError.mockReset();
  globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      patchBodies.push(body);
      return { ok: true, json: async () => ({ data: { max_recipients_per_blast: 2000, daily_send_cap: 2000, ...body } }) } as Response;
    }
    return {
      ok: true,
      json: async () => ({ data: { max_recipients_per_blast: 2000, daily_send_cap: 2000, daily_send_cap_min: 50, daily_send_cap_max: 5000 } }),
    } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

describe("EmailBlastSettingsCard — daily send limit", () => {
  it("an admin sees both limits, the allowed range and the reputation warning", async () => {
    render(<EmailBlastSettingsCard isAdmin />);
    expect(await screen.findByLabelText("Daily send limit")).toHaveValue(2000);
    expect(screen.getByLabelText("Recipient cap per blast")).toHaveValue(2000);
    expect(screen.getByText(/Allowed: 50–5,000/)).toBeInTheDocument();
    expect(screen.getByText(/Raise it gradually/)).toBeInTheDocument();
  });

  it("saving only the daily limit sends only that field", async () => {
    render(<EmailBlastSettingsCard isAdmin />);
    fireEvent.change(await screen.findByLabelText("Daily send limit"), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ daily_send_cap: 3000 });
  });

  it("refuses an out-of-range limit without calling the server", async () => {
    render(<EmailBlastSettingsCard isAdmin />);
    fireEvent.change(await screen.findByLabelText("Daily send limit"), { target: { value: "9000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/between 50 and 5,000/)));
    expect(patchBodies).toHaveLength(0);
  });

  it("a non-admin gets read-only values and no Save button", async () => {
    render(<EmailBlastSettingsCard isAdmin={false} />);
    expect(await screen.findByText("2,000")).toBeInTheDocument();
    expect(screen.queryByLabelText("Daily send limit")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
