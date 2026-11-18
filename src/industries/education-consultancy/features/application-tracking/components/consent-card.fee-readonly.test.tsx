// @vitest-environment jsdom
//
// Client request (Admizz, 2026-11-06): once the Processing Fee is saved, show it as submitted
// (read-only values + an "Edit" button) instead of a pending-looking form.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ConsentCard } from "./consent-card";

const NONE = {
  consent_enabled: true, status: "none", record: null, link: null,
  readiness: { ready: true, missing: [], groups: [] },
};

function renderCard(opts: { canManageFee: boolean; feeStatus: "paid" | "unpaid" | "waiver" | "claimed" | null }) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: NONE }) })));
  render(
    <ConsentCard leadId="lead-1" tenantId="tenant-1" consentEnabled consentSigned={false} canManage canManageFee={opts.canManageFee}
      showCollapsedStatus feeStatus={opts.feeStatus} feeAmount={opts.feeStatus === "paid" ? 150 : null} feeNotes="receipt 42" showProcessingFee />,
  );
}
const open = async () => fireEvent.click(await screen.findByRole("button", { expanded: false }));

beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("processing fee box after save", () => {
  it("owner/admin with a saved fee sees read-only values and an Edit button, no form", async () => {
    renderCard({ canManageFee: true, feeStatus: "paid" });
    await open();
    const box = await screen.findByTestId("fee-readonly");
    expect(box).toHaveTextContent("paid");
    expect(box).toHaveTextContent("150");
    expect(box).toHaveTextContent("receipt 42");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save fee" })).toBeNull();
    expect(screen.queryByPlaceholderText("Optional notes")).toBeNull();
  });

  it("clicking Edit re-opens the form", async () => {
    renderCard({ canManageFee: true, feeStatus: "paid" });
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.queryByTestId("fee-readonly")).toBeNull();
    expect(screen.getByPlaceholderText("Optional notes")).toBeInTheDocument();
  });

  it("with no saved fee the form shows straight away", async () => {
    renderCard({ canManageFee: true, feeStatus: null });
    await open();
    expect(await screen.findByPlaceholderText("Optional notes")).toBeInTheDocument();
    expect(screen.queryByTestId("fee-readonly")).toBeNull();
  });

  it("a reported fee shows Confirm / Reject plus Edit to the owner/admin", async () => {
    renderCard({ canManageFee: true, feeStatus: "claimed" });
    await open();
    await screen.findByTestId("fee-readonly");
    expect(screen.getByRole("button", { name: "Confirm fee received" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("a counsellor's reported fee keeps the 'Account will verify it' sentence and offers Edit", async () => {
    renderCard({ canManageFee: false, feeStatus: "claimed" });
    await open();
    await screen.findByTestId("fee-readonly");
    expect(screen.getByText("You reported this fee. The Account will verify it — you can keep working in the meantime.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm fee received" })).toBeNull();
  });
});
