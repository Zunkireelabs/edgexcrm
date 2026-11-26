// @vitest-environment jsdom
//
// EDGEX-154: the right rail (Consent & fee, Applications, Classes, Documents, Check-ins) and the tabs share ONE state per
// feature. These tests render the REAL hooks (useFee / useConsent / useLeadApplications / …) behind both the rail and the
// existing card bodies, with fetch mocked, so "an update in one shows in the other" is proven, not assumed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

const toastSuccess = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: (...a: unknown[]) => toastInfo(...a), message: vi.fn() } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
// The form itself is not under test — only who opens it and what happens after it saves.
vi.mock("../application-tracking/components/add-application-dialog", () => ({
  AddApplicationDialog: ({ open, onSaved }: { open: boolean; onSaved: () => void }) => (open ? <div><span>ADD APPLICATION FORM</span><button onClick={onSaved}>SAVE APPLICATION</button></div> : null),
}));

import type { Lead } from "@/types/database";
import { useFee } from "../application-tracking/hooks/use-fee";
import { useConsent } from "../application-tracking/hooks/use-consent";
import { useLeadApplications } from "../application-tracking/hooks/use-lead-applications";
import { useLeadEnrollments } from "../classes/hooks/use-lead-enrollments";
import { useLeadDocuments } from "../applicant-documents/use-lead-documents";
import { useLeadCheckIns } from "@/industries/_shared/features/check-in/lead-check-in";
import { ConsentCard } from "../application-tracking/components/consent-card";
import { ApplicationsCard } from "../application-tracking/components/applications-card";
import { RightRail } from "./right-rail";
import { FeePopover } from "./fee-popover";
import type { LeadFile } from "./lead-file";

let consentBody: Record<string, unknown>;
let applicationsBody: unknown[];
let maxFileBytes: number | null;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (method: string, match: string) => fetchMock.mock.calls.filter(([u, init]) => String(u).includes(match) && (init?.method ?? "GET") === method);
const body = (c: unknown[]) => JSON.parse((c[1] as { body: string }).body);

const consent = (o: Record<string, unknown> = {}) => ({
  consent_enabled: true, status: "none", record: null, link: null, readiness: { ready: true, missing: [] }, ...o,
});
const signed = consent({ status: "signed", record: { id: "r1", signer_name: "Aarav", signed_at: new Date(2026, 10, 10, 12).toISOString(), document_url: "https://x.test/doc.pdf", token: null, method: "link", sent_via: null } });

beforeEach(() => {
  consentBody = consent();
  applicationsBody = [];
  maxFileBytes = 25 * 1024 * 1024;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) });
    if (u.endsWith("/consent") && method === "POST") return ok({ link: "https://sign.test/abc" });
    if (u.endsWith("/consent")) return ok(consentBody);
    if (u.endsWith("/profile-completeness")) return ok({ complete: true, missing: [] });
    if (u.endsWith("/applications")) return ok(applicationsBody);
    if (u.includes("/application-stages")) return ok([]);
    if (u.endsWith("/classes") || u.endsWith("/check-ins")) return ok([]);
    if (u.endsWith("/documents")) return ok({ documents: [], applications: {}, max_file_bytes: maxFileBytes });
    if (u === "/api/v1/leads/lead-1" && method === "PATCH") return { ok: true, status: 200, json: async () => ({ data: {} }) };
    return ok([]);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); toastSuccess.mockClear(); toastInfo.mockClear(); });

type FeeInit = { status?: "paid" | "unpaid" | "waiver" | "claimed" | null; amount?: number | null };

/** The student file with real hooks. `consentSigned`/`locked` mirror what the page derives. */
function useFile(o: { admin: boolean; canManage?: boolean; fee?: FeeInit; locked?: boolean }) {
  const fee = useFee({ leadId: "lead-1", init: { status: o.fee?.status ?? null, amount: o.fee?.amount ?? null }, canManageFee: o.admin, canManage: o.canManage ?? true });
  const consentApi = useConsent({ leadId: "lead-1", tenantId: "t1", enabled: true });
  const applications = useLeadApplications("lead-1", { locked: !!o.locked });
  const enrollments = useLeadEnrollments("lead-1", {});
  const documents = useLeadDocuments("lead-1", {});
  const checkIns = useLeadCheckIns("lead-1", {});
  const file: LeadFile = { fee, consent: consentApi, applications, enrollments, documents, checkIns };
  return file;
}

function Rail({ admin = true, canManage = true, fee, locked = false, signedState = !locked, onEditProfile = () => {}, withTab = false }: {
  admin?: boolean; canManage?: boolean; fee?: FeeInit; locked?: boolean; signedState?: boolean; onEditProfile?: () => void; withTab?: boolean;
}) {
  const file = useFile({ admin, canManage, fee, locked });
  return (
    <>
      <RightRail
        lead={{ id: "lead-1" } as Lead} file={file} applicationsActive consentActive classesActive documentsActive checkInActive consentSigned={signedState}
        isAdmin={admin} canManageConsent={canManage} canManageApplications canEnroll canUpload teamMemberNames={{}} openTab={() => {}} onEditProfile={onEditProfile} onCheckIn={() => {}}
      />
      {/* The fee popover now lives on the stage card, not the rail (the rail is information only). */}
      <div data-testid="stage-fee"><FeePopover fee={file.fee}><button type="button">Record</button></FeePopover></div>
      {withTab && (
        <>
          <ConsentCard
            leadId="lead-1" tenantId="t1" consentEnabled consentSigned={signedState} canManage={canManage} canManageFee={admin} showCopyLink showCollapsedStatus
            feeApi={file.fee} consentApi={file.consent}
          />
          <ApplicationsCard leadId="lead-1" canManage disabled={locked} store={file.applications} />
        </>
      )}
      {file.consent.dialogs}
      {file.applications.dialogs}
      {file.documents.dialogs}
    </>
  );
}

const feeRow = () => screen.getByTestId("fee-row");
const consentRow = () => screen.getByTestId("consent-row");

describe("fee popover — by role", () => {
  it("ADMIN: segmented Paid / Unpaid / Waiver + Amount (Rs) + Note → Save; no 'Received' date (EDGEX-157)", async () => {
    render(<Rail admin />);
    fireEvent.click(await within(await screen.findByTestId("stage-fee")).findByRole("button", { name: "Record" }));
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Paid", "Unpaid", "Waiver"]);
    expect(screen.queryByText(/You report the fee/)).toBeNull();
    expect(screen.queryByText(/received/i)).toBeNull(); // no date field
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // nothing chosen yet
    fireEvent.click(screen.getByRole("radio", { name: "Paid" }));
    fireEvent.change(screen.getByLabelText("Amount (Rs)"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "Cash at desk" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls("PATCH", "/api/v1/leads/lead-1")).toHaveLength(1));
    expect(body(calls("PATCH", "/api/v1/leads/lead-1")[0])).toEqual({ pre_app_fee_status: "paid", pre_app_fee_amount: 5000, pre_app_fee_notes: "Cash at desk" });
    expect(toastSuccess).toHaveBeenCalledWith("Processing fee saved");
    await waitFor(() => expect(feeRow()).toHaveTextContent("Rs 5,000 · Paid"));
  });

  it("STAFF: the 'You report the fee…' line + Amount + Note → Report fee (no segmented control); saves as 'claimed'", async () => {
    render(<Rail admin={false} />);
    fireEvent.click(within(await screen.findByTestId("stage-fee")).getByRole("button", { name: "Record" }));
    expect(await screen.findByText("You report the fee; an admin confirms it. Reported counts for the Applications check.")).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    const report = screen.getByRole("button", { name: "Report fee" });
    expect(report).toBeDisabled(); // an amount is required
    fireEvent.change(screen.getByLabelText("Amount received (Rs)"), { target: { value: "5000" } });
    fireEvent.click(report);
    await waitFor(() => expect(calls("PATCH", "/api/v1/leads/lead-1")).toHaveLength(1));
    expect(body(calls("PATCH", "/api/v1/leads/lead-1")[0])).toMatchObject({ pre_app_fee_status: "claimed", pre_app_fee_amount: 5000 });
    expect(toastSuccess).toHaveBeenCalledWith("Fee reported — the Account will verify it");
    await waitFor(() => expect(feeRow()).toHaveTextContent("Rs 5,000 reported"));
    // a reported fee: staff get no Confirm / Reject
    expect(screen.queryByTestId("fee-confirm-reject")).toBeNull();
  });

  it("REPORTED state: the rail only shows it, with no Confirm / Reject (those live in the Consent tab card)", async () => {
    render(<Rail admin fee={{ status: "claimed", amount: 5000 }} />);
    await screen.findByTestId("fee-row");
    expect(feeRow()).toHaveTextContent("Rs 5,000 reported");
    expect(screen.queryByTestId("fee-confirm-reject")).toBeNull();
    expect(within(feeRow()).queryByRole("button")).toBeNull();
  });

  it("REPORTED state: staff (not admin) see the report but no Confirm / Reject", async () => {
    render(<Rail admin={false} fee={{ status: "claimed", amount: 5000 }} />);
    await screen.findByTestId("fee-row");
    expect(feeRow()).toHaveTextContent("Rs 5,000 reported");
    expect(screen.queryByTestId("fee-confirm-reject")).toBeNull();
  });
});

describe("consent row — information only", () => {
  it("never shows a button: not sent, copy link, view, complete, resend all live in the Consent tab", async () => {
    render(<Rail />);
    await waitFor(() => expect(consentRow()).toHaveTextContent("Not sent"));
    expect(within(consentRow()).queryByRole("button")).toBeNull();
    expect(within(feeRow()).queryByRole("button")).toBeNull();
    expect(calls("POST", "/consent")).toHaveLength(0);
  });

  it("profile incomplete: 'n fields missing' and the one-line note, no Complete / Send anyway buttons", async () => {
    consentBody = consent({ readiness: { ready: false, missing: ["Father's name", "Address"], groups: [{ section: "Family", fields: ["Father's name", "Address"] }] } });
    render(<Rail admin />);
    await waitFor(() => expect(consentRow()).toHaveTextContent("2 fields missing"));
    expect(screen.getByTestId("consent-missing")).toHaveTextContent("Missing for consent: Father's name, Address");
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Admins: Send anyway" })).toBeNull();
  });

  it("awaiting and expired show the state only", async () => {
    consentBody = consent({ status: "sent", link: "https://sign.test/abc" });
    render(<Rail />);
    await waitFor(() => expect(consentRow()).toHaveTextContent("Awaiting signature"));
    expect(within(consentRow()).queryByRole("button")).toBeNull();
    cleanup();
    consentBody = consent({ status: "expired" });
    render(<Rail />);
    await waitFor(() => expect(consentRow()).toHaveTextContent("Link expired"));
    expect(within(consentRow()).queryByRole("button")).toBeNull();
  });

  it("signed: 'Signed <date>' with a done tick and no View link; the fee shows a tick once paid or waived", async () => {
    consentBody = signed;
    render(<Rail signedState fee={{ status: "waiver" }} />);
    await waitFor(() => expect(consentRow()).toHaveTextContent("Signed Nov 10"));
    expect(within(consentRow()).getByLabelText("Done")).toBeInTheDocument();
    expect(within(consentRow()).queryByRole("button")).toBeNull();
    expect(feeRow()).toHaveTextContent("Waiver");
    expect(within(feeRow()).getByLabelText("Done")).toBeInTheDocument();
  });

  it("a fee that is not paid / waived gets no tick", async () => {
    render(<Rail fee={{ status: "unpaid" }} />);
    await screen.findByTestId("fee-row");
    expect(within(feeRow()).queryByLabelText("Done")).toBeNull();
  });
});

describe("rail and tab share ONE state", () => {
  it("the fee saved from the rail popover updates the Consent tab's card (same useFee): 'Fee pending' → 'Fee reported'", async () => {
    consentBody = signed;
    render(<Rail admin={false} signedState withTab />);
    // collapsed Consent tab header shows the signed-but-fee-pending badge
    await screen.findByText("Fee pending");
    fireEvent.click(within(screen.getByTestId("stage-fee")).getByRole("button", { name: "Record" }));
    fireEvent.change(await screen.findByLabelText("Amount received (Rs)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Report fee" }));
    await waitFor(() => expect(screen.getByText("Fee reported")).toBeInTheDocument());
    expect(screen.queryByText("Fee pending")).toBeNull();
    expect(calls("PATCH", "/api/v1/leads/lead-1")).toHaveLength(1); // one save, both views follow
  });

  it("applications: ONE fetch feeds both; the rail lists the university name only (no status, no '+')", async () => {
    applicationsBody = [{ id: "a1", university_name: "University of Melbourne", program_name: "Nursing", application_stages: { name: "Preparing" } }];
    render(<Rail withTab />);
    const rail = await screen.findByTestId("rail-applications");
    await waitFor(() => expect(within(rail).getByText(/University of Melbourne · Nursing/)).toBeInTheDocument());
    expect(within(rail).queryByText("Preparing")).toBeNull(); // status lives in the lead page
    expect(within(rail).queryByRole("button", { name: /Add application/ })).toBeNull();
    expect(within(rail).getByText("1")).toBeInTheDocument(); // count chip
    expect(screen.getByText("University of Melbourne", { selector: "p" })).toBeInTheDocument(); // the tab's card shows it too
    expect(calls("GET", "/leads/lead-1/applications")).toHaveLength(1);
  });
});

describe("Applications section while consent is pending", () => {
  it("locked: the empty row says 'Unlocks after consent' and the rail has no add button (the tab's Add is the one that explains)", async () => {
    render(<Rail locked />);
    const rail = await screen.findByTestId("rail-applications");
    expect(within(rail).getByText("Unlocks after consent")).toBeInTheDocument();
    expect(within(rail).queryByRole("button", { name: /Add application/ })).toBeNull();
    expect(calls("GET", "/profile-completeness")).toHaveLength(0);
  });
});

describe("Documents, Classes and Check-ins on the rail are information only", () => {
  it("no upload / add / check-in buttons, and each empty row is plain text; only the section titles are buttons", async () => {
    render(<Rail />);
    for (const id of ["rail-documents", "rail-classes", "rail-checkins", "rail-applications"]) {
      const sec = await screen.findByTestId(id);
      const buttons = within(sec).queryAllByRole("button");
      expect(buttons).toHaveLength(1); // the title that opens the tab
      expect(buttons[0].getAttribute("title")).toMatch(/^Open the .* tab$/);
    }
  });
});
