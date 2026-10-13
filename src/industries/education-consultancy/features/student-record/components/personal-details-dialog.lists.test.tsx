// @vitest-environment jsdom
//
// Work Experience, References and Test Scores are rows in their own tables, loaded when the pop-up opens and saved with PUT
// /api/v1/leads/[id]/student-record after the lead itself. These tests drive the real dialog against a fake server.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { PersonalDetailsDialog } from "./personal-details-dialog";

// The dialog renders every section; on a busy machine that takes seconds, so wait generously.
vi.setConfig({ testTimeout: 30_000 });
const WAIT = { timeout: 15_000 };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), warning: (...a: unknown[]) => toastWarning(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

const ID = "6f1c1c1e-1b2a-4c3d-8e9f-0a1b2c3d4e5f";
const LEAD = { id: "lead-1", custom_fields: {}, destinations: [], degree_level: "Undergraduate" };
const STORED = {
  work_experience: [{ id: ID, institution_name: "Admizz Education", address: "Baneshwor", position: "Counselor", start_date: "2022-01-31", end_date: null }],
  references: [{ id: "22222222-3333-4444-8555-666666666666", referee_name: "Dr Rai", position: "Head", organization: "TU", email: "rai@tu.edu", address: "KTM", relationship: "Teacher" }],
  test_scores: [{ id: "33333333-4444-4555-8666-777777777777", exam_type: "Duolingo English Test", date_of_exam: null, listening: null, reading: null, writing: null, speaking: null, overall: "120" }],
};

interface Server {
  stored: typeof STORED;
  listsGet?: () => Response | Promise<Response>;
  listsPut?: (body: Record<string, unknown>) => Response | Promise<Response>;
  patch?: (body: Record<string, unknown>) => Response | Promise<Response>;
}
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => ({ data }) }) as Response;

function setup(server: Server, props: { openInEditMode?: boolean } = {}) {
  const calls: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method, url, body });
    if (url.endsWith("/student-record")) {
      if (method === "PUT") {
        const res = await (server.listsPut ?? ((b: Record<string, unknown>) => json({ ...server.stored, ...b })))(body);
        // A real server keeps what it stored: later reads (the dialog and the lead page's card reload after a save) return it.
        if (res.ok) server.stored = (await res.json()).data;
        return res;
      }
      return (server.listsGet ?? (() => json(server.stored)))();
    }
    if (method === "PATCH") return (server.patch ?? (() => json({ ...LEAD })))(body);
    return json({});
  }) as unknown as typeof fetch;
  render(<PersonalDetailsDialog lead={LEAD as unknown as Lead} open onOpenChange={() => {}} openInEditMode={props.openInEditMode ?? true} />);
  return { calls, puts: () => calls.filter((c) => c.method === "PUT"), patches: () => calls.filter((c) => c.method === "PATCH") };
}
const save = () => fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

describe("Student Details lists — loading", () => {
  it("loads the stored work experience, references and test scores when the pop-up opens", async () => {
    setup({ stored: STORED });
    await screen.findByDisplayValue("Admizz Education", {}, WAIT);
    expect(screen.getByDisplayValue("Dr Rai")).toBeInTheDocument();
    // Duolingo has no old overall-score column — it only exists in the new table, so seeing it proves the table is read
    expect(screen.getByDisplayValue("120")).toBeInTheDocument();
  });

  it("does not let a list be edited until it has loaded (so an empty not-yet-loaded list can never be saved over the stored one)", async () => {
    let release: (r: Response) => void = () => {};
    setup({ stored: STORED, listsGet: () => new Promise<Response>((r) => { release = r; }) });
    await screen.findAllByText("Loading saved entries…", {}, WAIT);
    expect(screen.queryByRole("button", { name: /Add Work Experience/ })).toBeNull();
    release(json(STORED));
    await screen.findByDisplayValue("Admizz Education", {}, WAIT);
    expect(screen.getByRole("button", { name: /Add Work Experience/ })).toBeInTheDocument();
  });

  it("if the lists cannot be loaded it says so, offers to retry, and keeps them read-only", async () => {
    setup({ stored: STORED, listsGet: () => json({}, 503) });
    await screen.findAllByText(/Couldn't load the saved entries/, {}, WAIT);
    expect(screen.queryByRole("button", { name: /Add Reference/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
  });
});

describe("Student Details lists — saving", () => {
  it("sends only the list that changed, and afterwards shows the rows the SERVER stored", async () => {
    const { puts } = setup({
      stored: STORED,
      listsPut: (body) => json({ ...STORED, work_experience: [{ ...STORED.work_experience[0], institution_name: "As stored by the server" }], ...(body ? {} : {}) }),
    });
    const input = await screen.findByDisplayValue("Admizz Education", {}, WAIT);
    fireEvent.change(input, { target: { value: "Typed institution" } });
    save();
    await screen.findByText("As stored by the server", {}, WAIT);
    expect(puts()).toHaveLength(1);
    expect(Object.keys(puts()[0].body)).toEqual(["work_experience"]);
    expect(puts()[0].body.work_experience).toEqual([expect.objectContaining({ id: ID, institution_name: "Typed institution" })]);
    expect(screen.queryByText("Typed institution")).toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith("Saved.");
  });

  it("adding a reference sends it; deleting the last work experience sends an empty list", async () => {
    const { puts } = setup({ stored: STORED });
    await screen.findByDisplayValue("Admizz Education", {}, WAIT);
    fireEvent.click(screen.getByRole("button", { name: /Add Reference/ }));
    // remove the work-experience entry
    const card = screen.getByDisplayValue("Admizz Education").closest("div.relative") as HTMLElement;
    fireEvent.click(within(card).getAllByRole("button")[0]);
    save();
    await waitFor(() => expect(puts()).toHaveLength(1), WAIT);
    const body = puts()[0].body as { work_experience: unknown[]; references: Array<Record<string, unknown>> };
    expect(body.work_experience).toEqual([]);
    expect(body.references).toHaveLength(2);
  });

  it("makes no list request when only a flat field changed", async () => {
    const { puts, patches } = setup({ stored: STORED });
    await screen.findByDisplayValue("Admizz Education", {}, WAIT);
    fireEvent.change(screen.getAllByPlaceholderText("Enter address of institution")[0], { target: { value: "A school address" } });
    save();
    await waitFor(() => expect(patches()).toHaveLength(1), WAIT);
    expect(patches()[0].body).toMatchObject({ see_address: "A school address" });
    expect(puts()).toHaveLength(0);
  });

  it("makes no request at all when nothing changed", async () => {
    const { calls } = setup({ stored: STORED });
    await screen.findByDisplayValue("Admizz Education", {}, WAIT);
    save();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Nothing to save — no changes were made."), WAIT);
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("a refused list save (bad data) keeps the dialog open with the entries still there, and says what failed", async () => {
    setup({ stored: STORED, listsPut: () => json({}, 422) });
    const input = await screen.findByDisplayValue("Admizz Education", {}, WAIT);
    fireEvent.change(input, { target: { value: "Edited" } });
    save();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("could not be saved")), WAIT);
    expect(screen.getByDisplayValue("Edited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeInTheDocument(); // still editing
  });

  it("when the lead saves but the lists do not, the other changes are kept, the entries stay editable, and a retry sends only the lists", async () => {
    let putAttempts = 0;
    const { patches, puts } = setup({
      stored: STORED,
      listsPut: () => (++putAttempts === 1 ? json({}, 503) : json({ ...STORED, references: [{ ...STORED.references[0], referee_name: "Dr Rai (saved)" }] })),
      patch: () => json({ ...LEAD, see_address: "Kept address" }),
    });
    await screen.findByDisplayValue("Dr Rai", {}, WAIT);
    fireEvent.change(screen.getAllByPlaceholderText("Enter address of institution")[0], { target: { value: "Kept address" } });
    fireEvent.change(screen.getByDisplayValue("Dr Rai"), { target: { value: "Dr Rai (edited)" } });
    save();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Your other changes were saved")), WAIT);
    expect(patches()).toHaveLength(1);
    save(); // retry
    await screen.findByText("Dr Rai (saved)", {}, WAIT); // saved: the dialog is back in read-only view
    expect(patches()).toHaveLength(1); // the lead was NOT saved twice
    expect(puts()).toHaveLength(2);
    expect(Object.keys(puts()[1].body)).toEqual(["references"]);
  });
});
