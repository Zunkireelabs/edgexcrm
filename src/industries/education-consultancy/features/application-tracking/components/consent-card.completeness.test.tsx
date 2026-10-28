// @vitest-environment jsdom
//
// Client request (Pre Application card): the green signal must show only when BOTH the Processing Fee and
// the Student Consent are complete. Consent signed with the fee still pending must NOT look finished.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ConsentCard } from "./consent-card";

const SIGNED = {
  data: {
    consent_enabled: true,
    status: "signed",
    record: { signer_name: "Paras Karki", signed_at: "2026-10-01T10:00:00Z", document_url: null },
    link: null,
  },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => SIGNED })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCard(props: {
  feeStatus?: "paid" | "unpaid" | "waiver" | "claimed" | null;
  showProcessingFee?: boolean;
  canManage?: boolean;
  canManageFee?: boolean;
  feeAmount?: number | null;
}) {
  render(
    <ConsentCard
      leadId="lead-1"
      tenantId="tenant-1"
      consentEnabled
      consentSigned
      canManage={props.canManage ?? true}
      canManageFee={props.canManageFee ?? false}
      showCollapsedStatus
      feeStatus={props.feeStatus ?? null}
      feeAmount={props.feeAmount ?? null}
      showProcessingFee={props.showProcessingFee ?? true}
    />,
  );
}

const openCard = () => fireEvent.click(screen.getByRole("button", { expanded: false }));
const signedLine = () => screen.getByText("Consent signed").closest("div")!.parentElement!;

describe("collapsed header badge", () => {
  it("is green 'Signed' only when consent is signed AND the fee is Paid", async () => {
    renderCard({ feeStatus: "paid" });
    expect(await screen.findByText("Signed")).toBeInTheDocument();
    expect(screen.queryByText("Fee pending")).toBeNull();
  });

  it("is green when the fee is Waived", async () => {
    renderCard({ feeStatus: "waiver" });
    expect(await screen.findByText("Signed")).toBeInTheDocument();
  });

  it("is NOT green when consent is signed but the fee is not set", async () => {
    renderCard({ feeStatus: null });
    expect(await screen.findByText("Fee pending")).toBeInTheDocument();
    expect(screen.queryByText("Signed")).toBeNull();
  });

  it("is NOT green when the fee is Unpaid", async () => {
    renderCard({ feeStatus: "unpaid" });
    expect(await screen.findByText("Fee pending")).toBeInTheDocument();
    expect(screen.queryByText("Signed")).toBeNull();
  });

  it("stays green when the card has no fee section at all", async () => {
    renderCard({ showProcessingFee: false });
    expect(await screen.findByText("Signed")).toBeInTheDocument();
  });
});

describe("opened card", () => {
  it("shows the Consent signed line in green, and a green Done on the fee, when both are complete", async () => {
    renderCard({ feeStatus: "paid" });
    await screen.findByText("Signed");
    openCard();
    await waitFor(() => expect(screen.getByText("Consent signed")).toBeInTheDocument());
    expect(signedLine().className).toContain("text-green-600");
    expect(signedLine().className).not.toContain("text-amber-600");
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Processing fee pending")).toBeNull();
  });

  it("turns the Consent signed line amber and says the fee is pending when the fee is not done", async () => {
    renderCard({ feeStatus: null });
    await screen.findByText("Fee pending");
    openCard();
    await waitFor(() => expect(screen.getByText("Consent signed")).toBeInTheDocument());
    expect(signedLine().className).toContain("text-amber-600");
    expect(signedLine().className).not.toContain("text-green-600");
    expect(screen.getByText("Processing fee pending")).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    // The facts are still shown: who signed and when.
    expect(screen.getByText(/Paras Karki/)).toBeInTheDocument();
  });
});

describe("a counsellor-reported fee ('claimed')", () => {
  it("is NOT green (awaiting owner verification) but is labelled as reported, not pending", async () => {
    renderCard({ feeStatus: "claimed", feeAmount: 5000 });
    expect(await screen.findByText("Fee reported")).toBeInTheDocument();
    expect(screen.queryByText("Signed")).toBeNull();
    expect(screen.queryByText("Fee pending")).toBeNull();
  });

  it("says the fee is awaiting owner verification when the card is opened", async () => {
    renderCard({ feeStatus: "claimed", feeAmount: 5000 });
    await screen.findByText("Fee reported");
    openCard();
    await waitFor(() => expect(screen.getByText("Consent signed")).toBeInTheDocument());
    expect(screen.getByText("Awaiting verification")).toBeInTheDocument();
    expect(screen.getByText("Processing fee reported — awaiting owner verification")).toBeInTheDocument();
  });

  it("lets a counsellor report a fee, sending only status 'claimed' (never 'paid')", async () => {
    renderCard({ feeStatus: null });
    await screen.findByText("Fee pending");
    openCard();
    const amount = await screen.findByPlaceholderText("0.00");
    fireEvent.change(amount, { target: { value: "5000" } });
    fireEvent.click(await screen.findByRole("button", { name: "Report fee received" }));
    await waitFor(() => {
      const patch = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as RequestInit).body as string);
      expect(body.pre_app_fee_status).toBe("claimed");
      expect(body.pre_app_fee_amount).toBe(5000);
    });
    // Card is open, so the collapsed-header badge is hidden; the inline status shows instead.
    expect(await screen.findByText("Awaiting verification")).toBeInTheDocument();
  });

  it("lets an owner/admin confirm a reported fee in one click (sends 'paid')", async () => {
    renderCard({ feeStatus: "claimed", feeAmount: 5000, canManageFee: true });
    await screen.findByText("Fee reported");
    openCard();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm fee received" }));
    await waitFor(() => {
      const patch = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as RequestInit).body as string);
      expect(body.pre_app_fee_status).toBe("paid");
      expect(body.pre_app_fee_amount).toBe(5000);
    });
  });

  it("lets an owner/admin reject a reported fee (sends 'unpaid')", async () => {
    renderCard({ feeStatus: "claimed", feeAmount: 5000, canManageFee: true });
    await screen.findByText("Fee reported");
    openCard();
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    await waitFor(() => {
      const patch = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      const body = JSON.parse((patch![1] as RequestInit).body as string);
      expect(body.pre_app_fee_status).toBe("unpaid");
    });
  });

  it("tells staff the fee never blocks consent or the application", async () => {
    renderCard({ feeStatus: null, canManage: false });
    await screen.findByText("Fee pending");
    openCard();
    expect(await screen.findByText(/never blocks the consent form or the application/)).toBeInTheDocument();
  });

  it("does not offer the report form once an admin has recorded the fee", async () => {
    renderCard({ feeStatus: "unpaid" });
    await screen.findByText("Fee pending");
    openCard();
    await waitFor(() => expect(screen.getByText("Consent signed")).toBeInTheDocument());
    expect(screen.queryByPlaceholderText("0.00")).toBeNull();
    expect(screen.queryByRole("button", { name: "Report fee received" })).toBeNull();
  });

  it("does not offer the report form to someone who cannot manage consent", async () => {
    renderCard({ feeStatus: null, canManage: false });
    await screen.findByText("Fee pending");
    openCard();
    await waitFor(() => expect(screen.getByText("Consent signed")).toBeInTheDocument());
    expect(screen.queryByPlaceholderText("0.00")).toBeNull();
  });
});
