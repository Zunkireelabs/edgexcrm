// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: toastInfo } }));

import { ConsentCard } from "./consent-card";

const LINK = "https://crm.test/consent/abc-123";
const NO_CONSENT = { data: { consent_enabled: true, status: "none", record: null, link: null } };

let postResponse: { ok: boolean; status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;
const writeText = vi.fn();

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  toastInfo.mockReset();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  postResponse = { ok: true, status: 201, body: { data: { id: "new", status: "sent", sent_via: "link", link: LINK } } };
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return { ok: postResponse.ok, status: postResponse.status, json: async () => postResponse.body };
    }
    return { ok: true, status: 200, json: async () => NO_CONSENT };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCard(showCopyLink?: boolean) {
  render(
    <ConsentCard
      leadId="lead-1"
      tenantId="tenant-1"
      consentEnabled
      consentSigned={false}
      canManage
      canManageFee={false}
      showProcessingFee={false}
      showCopyLink={showCopyLink}
    />
  );
}

/** The card starts collapsed; wait for the status fetch, then open it. */
async function openCard() {
  fireEvent.click(await screen.findByRole("button", { name: /pre application/i }));
  await screen.findByText("Consent required");
}

const postCalls = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
const getCalls = () => fetchMock.mock.calls.filter(([, init]) => !(init as RequestInit | undefined)?.method);

describe("ConsentCard — Copy consent link", () => {
  it("is not shown unless the page turns it on (real-estate and other callers are unchanged)", async () => {
    renderCard();
    await openCard();

    expect(screen.getByRole("button", { name: "Send consent link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy consent link/i })).not.toBeInTheDocument();
  });

  it("shows all four actions when turned on", async () => {
    renderCard(true);
    await openCard();

    for (const name of ["Send consent link", "Copy consent link", "Sign here now", "Record manually"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("one click creates the link WITHOUT emailing it, copies it, and refreshes the status", async () => {
    renderCard(true);
    await openCard();
    const readsBefore = getCalls().length;

    fireEvent.click(screen.getByRole("button", { name: "Copy consent link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    expect(postCalls()).toHaveLength(1);
    expect(JSON.parse((postCalls()[0][1] as RequestInit).body as string)).toEqual({ action: "send", deliver: "none" });
    expect(toastSuccess).toHaveBeenCalledWith("Consent link copied");
    await waitFor(() => expect(getCalls().length).toBeGreaterThan(readsBefore)); // card re-reads its status
  });

  it("still succeeds when the browser refuses the clipboard: the link exists and the card refreshes", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderCard(true);
    await openCard();
    const readsBefore = getCalls().length;

    fireEvent.click(screen.getByRole("button", { name: "Copy consent link" }));

    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith("Link created — use Copy link"));
    expect(toastError).not.toHaveBeenCalled();
    await waitFor(() => expect(getCalls().length).toBeGreaterThan(readsBefore));
  });

  it("shows a big pop-up (not a fading toast) and refreshes when consent is already signed", async () => {
    postResponse = { ok: false, status: 409, body: { error: { code: "ALREADY_SIGNED", message: "Consent is already signed for this lead" } } };
    renderCard(true);
    await openCard();
    const readsBefore = getCalls().length;

    fireEvent.click(screen.getByRole("button", { name: "Copy consent link" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Consent is already signed")).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    await waitFor(() => expect(getCalls().length).toBeGreaterThan(readsBefore));
  });

  it("keeps an ordinary failure as a normal toast, not a pop-up", async () => {
    postResponse = { ok: false, status: 500, body: { error: { code: "DB_ERROR", message: "Failed to create consent record" } } };
    renderCard(true);
    await openCard();

    fireEvent.click(screen.getByRole("button", { name: "Copy consent link" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Failed to create consent record"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
