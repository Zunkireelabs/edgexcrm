// @vitest-environment jsdom
//
// Client request (Admizz, 2026-11-05): show the "Can't move to Applications yet" warning — Basic Info,
// Processing Fee, Consent Form — while Pre-Application is still incomplete, not only when the move is blocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ConsentCard } from "./consent-card";

const SIGNED = { consent_enabled: true, status: "signed", record: { signer_name: "A", signed_at: "2026-10-01T10:00:00Z", document_url: null }, link: null };
const NONE_INCOMPLETE = {
  consent_enabled: true, status: "none", record: null, link: null,
  readiness: { ready: false, missing: ["Passport Number"], groups: [{ section: "Passport & Citizenship", fields: ["Passport Number"] }] },
};
const NONE_READY = { ...NONE_INCOMPLETE, readiness: { ready: true, missing: [], groups: [] } };

function renderCard(status: unknown, feeStatus: "paid" | "unpaid" | "waiver" | "claimed" | null) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: status }) })));
  render(
    <ConsentCard leadId="lead-1" tenantId="tenant-1" consentEnabled consentSigned={(status as { status: string }).status === "signed"} canManage canManageFee={false} showCollapsedStatus feeStatus={feeStatus} showProcessingFee />,
  );
}
const open = async () => fireEvent.click(await screen.findByRole("button", { expanded: false }));

beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("pre-application early warning", () => {
  it("lists Basic Info, Processing Fee and Consent Form when none are done", async () => {
    renderCard(NONE_INCOMPLETE, null);
    await open();
    const box = await screen.findByTestId("pre-app-warning");
    expect(box).toHaveTextContent("Basic Info (Passport Number)");
    expect(box).toHaveTextContent("Processing Fee");
    expect(box).toHaveTextContent("Consent Form");
  });

  it("a counsellor-reported fee ('claimed') counts as done, like the gate", async () => {
    renderCard(NONE_READY, "claimed");
    await open();
    const box = await screen.findByTestId("pre-app-warning");
    expect(box).not.toHaveTextContent("Processing Fee");
    expect(box).not.toHaveTextContent("Basic Info");
    expect(box).toHaveTextContent("Consent Form");
  });

  it("shows no warning once fee is entered and consent is signed", async () => {
    renderCard(SIGNED, "paid");
    await open();
    await screen.findByText("Consent signed");
    expect(screen.queryByTestId("pre-app-warning")).toBeNull();
  });
});
