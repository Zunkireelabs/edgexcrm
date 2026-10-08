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
  // jsdom has no ResizeObserver; Radix (tooltip) needs one.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCard(showCopyLink?: boolean, isOwnerOrAdmin = false, onOpenStudentDetails?: () => void) {
  render(
    <ConsentCard
      leadId="lead-1"
      tenantId="tenant-1"
      consentEnabled
      consentSigned={false}
      canManage
      canManageFee={isOwnerOrAdmin}
      canOverrideProfileCheck={isOwnerOrAdmin}
      showProcessingFee={false}
      showCopyLink={showCopyLink}
      onOpenStudentDetails={onOpenStudentDetails}
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

describe("ConsentCard — incomplete student profile gate", () => {
  const INCOMPLETE = {
    data: {
      consent_enabled: true,
      status: "none",
      record: null,
      link: null,
      readiness: { ready: false, missing: ["Passport Number", "Father's Name"] },
    },
  };
  const ACTIONS = ["Send consent link", "Copy consent link", "Sign here now", "Record manually"];

  function statusIs(body: unknown) {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, status: 201, json: async () => postResponse.body };
      return { ok: true, status: 200, json: async () => body };
    });
  }

  it("warns twice (complete the profile + what is missing) and disables all four actions", async () => {
    statusIs(INCOMPLETE);
    renderCard(true);
    await openCard();

    expect(screen.getByText("Complete the student profile first")).toBeInTheDocument();
    expect(screen.getByText(/half-filled profile/i)).toBeInTheDocument();
    expect(screen.getByText("Fill in all of these before consent can go out:")).toBeInTheDocument();
    expect(screen.getByText("Passport Number, Father's Name")).toBeInTheDocument();
    for (const name of ACTIONS) expect(screen.getByRole("button", { name })).toBeDisabled();
  });

  it("offers 'Open Student Details' for profile gaps, but not when the only gap is the assigned counselor", async () => {
    statusIs(INCOMPLETE);
    renderCard(true, false, () => {});
    await openCard();
    expect(screen.getByRole("button", { name: /Open Student Details/ })).toBeInTheDocument();
    cleanup();

    // The counselor isn't set in Student Details, so that button would lead nowhere.
    statusIs({
      data: {
        ...INCOMPLETE.data,
        readiness: {
          ready: false,
          missing: ["Assigned Counselor"],
          groups: [{ section: "Assignment", fields: ["Assigned Counselor"] }],
        },
      },
    });
    renderCard(true, false, () => {});
    await openCard();
    expect(screen.getByText("Assign a counselor to this lead.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Student Details/ })).not.toBeInTheDocument();
  });

  it("leaves the actions enabled when the profile is ready (or the server sends no gate)", async () => {
    statusIs({ data: { ...INCOMPLETE.data, readiness: { ready: true, missing: [] } } });
    renderCard(true);
    await openCard();

    expect(screen.queryByText("Complete the student profile first")).not.toBeInTheDocument();
    for (const name of ACTIONS) expect(screen.getByRole("button", { name })).toBeEnabled();
  });

  it("explains why when hovering the blocked buttons, and stays reliable after clicks and re-hovers", async () => {
    statusIs(INCOMPLETE);
    renderCard(true);
    await openCard();

    // One hint for the whole group (not one per button): hovering anywhere over the buttons shows it.
    const group = screen.getByRole("button", { name: "Copy consent link" }).parentElement as HTMLElement;
    expect(group).toHaveAttribute("tabindex", "0");
    expect(group).toContainElement(screen.getByRole("button", { name: "Record manually" }));
    fireEvent.pointerEnter(group);

    // The hover hint repeats the missing items (one per line) and says where to fix them.
    expect((await screen.findAllByText("Add them in Student Details (Edit).")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Passport Number, Father's Name").length).toBeGreaterThan(1); // warning box + tooltip

    // Leaving hides it, and a click on the group (Radix would keep it shut) does not break the next hover.
    fireEvent.pointerLeave(group);
    await waitFor(() => expect(screen.queryAllByText("Add them in Student Details (Edit).")).toHaveLength(0));
    fireEvent.pointerDown(group);
    fireEvent.click(group);
    fireEvent.pointerEnter(group);
    expect((await screen.findAllByText("Add them in Student Details (Edit).")).length).toBeGreaterThan(0);
  });

  it("groups the missing fields by Student Details section so staff know where to fill each one", async () => {
    statusIs({
      data: {
        ...INCOMPLETE.data,
        readiness: {
          ready: false,
          missing: ["Date of Birth", "Father's Name", "Passport Number"],
          groups: [
            { section: "Basic Details", fields: ["Date of Birth", "Father's Name"] },
            { section: "Passport & Citizenship", fields: ["Passport Number"] },
          ],
        },
      },
    });
    renderCard(true);
    await openCard();

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toContain("Basic Details: Date of Birth, Father's Name");
    expect(items).toContain("Passport & Citizenship: Passport Number");
  });

  it("never gets stuck: the hint closes if the pointer is elsewhere, the window loses focus, or the page scrolls", async () => {
    statusIs(INCOMPLETE);
    renderCard(true);
    await openCard();
    const group = screen.getByRole("button", { name: "Copy consent link" }).parentElement as HTMLElement;
    const hintGone = () => waitFor(() => expect(screen.queryAllByText("Add them in Student Details (Edit).")).toHaveLength(0));

    // A "pointer left" that the browser never reported — the pointer is simply somewhere else.
    fireEvent.pointerEnter(group);
    expect((await screen.findAllByText("Add them in Student Details (Edit).")).length).toBeGreaterThan(0);
    fireEvent.pointerMove(document.body);
    await hintGone();

    // Window loses focus (e.g. a screenshot).
    fireEvent.pointerEnter(group);
    expect((await screen.findAllByText("Add them in Student Details (Edit).")).length).toBeGreaterThan(0);
    fireEvent.blur(window);
    await hintGone();

    // The page scrolls under a resting pointer.
    fireEvent.pointerEnter(group);
    expect((await screen.findAllByText("Add them in Student Details (Edit).")).length).toBeGreaterThan(0);
    fireEvent.scroll(document); // real page scrolls are dispatched on the document
    await hintGone();
  });

  it("keeps the hint open while the pointer moves within the buttons", async () => {
    statusIs(INCOMPLETE);
    renderCard(true);
    await openCard();
    const group = screen.getByRole("button", { name: "Copy consent link" }).parentElement as HTMLElement;

    fireEvent.pointerEnter(group);
    expect((await screen.findAllByText("Add them in Student Details (Edit).")).length).toBeGreaterThan(0);
    fireEvent.pointerMove(group);
    expect(screen.getAllByText("Add them in Student Details (Edit).").length).toBeGreaterThan(0);
  });

  it("shows an Open Student Details button only when the page can open that pop-up", async () => {
    statusIs(INCOMPLETE);
    const onOpen = vi.fn();
    render(
      <ConsentCard
        leadId="lead-1"
        tenantId="tenant-1"
        consentEnabled
        consentSigned={false}
        canManage
        canManageFee={false}
        showProcessingFee={false}
        showCopyLink
        onOpenStudentDetails={onOpen}
      />
    );
    await openCard();

    fireEvent.click(screen.getByRole("button", { name: "Open Student Details" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("has no Open Student Details button when the page cannot open the pop-up", async () => {
    statusIs(INCOMPLETE);
    renderCard(true);
    await openCard();

    expect(screen.queryByRole("button", { name: "Open Student Details" })).not.toBeInTheDocument();
  });

  it("adds no tooltip wrapper once the profile is ready", async () => {
    statusIs({ data: { ...INCOMPLETE.data, readiness: { ready: true, missing: [] } } });
    renderCard(true);
    await openCard();

    const button = screen.getByRole("button", { name: "Copy consent link" });
    expect(button.parentElement).not.toHaveAttribute("tabindex"); // plain group, no hint
  });

  it("offers no override to non-admins", async () => {
    statusIs(INCOMPLETE);
    renderCard(true, false);
    await openCard();

    expect(screen.queryByRole("button", { name: /send anyway/i })).not.toBeInTheDocument();
  });

  it("lets an admin send anyway only after confirming, and then sends the override flag", async () => {
    statusIs(INCOMPLETE);
    renderCard(true, true);
    await openCard();

    fireEvent.click(screen.getByRole("button", { name: "Send anyway (admin)" }));
    expect(await screen.findByText("Send consent with missing details?")).toBeInTheDocument();
    for (const name of ACTIONS) expect(screen.getByRole("button", { name, hidden: true })).toBeDisabled(); // not unlocked until confirmed

    fireEvent.click(screen.getByRole("button", { name: "Send anyway" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy consent link" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Copy consent link" }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(JSON.parse((postCalls()[0][1] as RequestInit).body as string)).toEqual({
      action: "send",
      deliver: "none",
      override_profile_check: true,
    });
  });
});
