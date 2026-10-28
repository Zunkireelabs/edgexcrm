// @vitest-environment jsdom
//
// "Auto-enroll by stage" card (migration 277). Pins: it hides itself on accounts without stages; unticked it asks nothing;
// ticked it shows the chosen stages as removable chips and an "add stage" picker; a stage another ACTIVE sequence holds on the
// same channel shows the replace warning (not for this sequence's own rule, not for the other channel); the catch-up checkbox
// only appears with a count, and the "drafts to review" note only when Auto-send is off; wording follows the channel.

import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select aria-label="Add a stage" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">—</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import { StageAutoEnrollCard, takenByOthers, EMPTY_STAGE_RULE, type StageRuleDraft } from "./stage-auto-enroll-card";

const QUALIFIED = "l-qualified";
const PROSPECTS = "l-prospects";
const APPLICATIONS = "l-applications";

let lists: Array<Record<string, unknown>> | "forbidden";
let rules: Array<Record<string, unknown>>;
let leadsInStages: number | null;
let countUrls: string[];

beforeEach(() => {
  lists = [
    { id: QUALIFIED, name: "Qualified", is_archive: false },
    { id: PROSPECTS, name: "Prospects", is_archive: false },
    { id: APPLICATIONS, name: "Applications", is_archive: false },
    { id: "l-archive", name: "Archived", is_archive: true },
  ];
  rules = [];
  leadsInStages = 412;
  countUrls = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.startsWith("/api/v1/lead-lists")) {
      return lists === "forbidden" ? ({ ok: false, status: 403, json: async () => ({}) } as Response) : ({ ok: true, json: async () => ({ data: lists }) } as Response);
    }
    if (u.startsWith("/api/v1/outreach/stage-triggers")) {
      if (u.includes("count_list_ids")) countUrls.push(u);
      return { ok: true, json: async () => ({ data: { rules, leads_in_stages: u.includes("count_list_ids") ? leadsInStages : null } }) } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

function Harness({
  initial = EMPTY_STAGE_RULE,
  channel = "email",
  sequenceId = null,
  autoSend = false,
  onChange,
  onAvailable,
  onTakenChange,
}: {
  initial?: StageRuleDraft;
  channel?: "email" | "sms";
  sequenceId?: string | null;
  autoSend?: boolean;
  onChange?: (v: StageRuleDraft) => void;
  onAvailable?: (a: boolean) => void;
  onTakenChange?: (t: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <StageAutoEnrollCard
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      channel={channel}
      sequenceId={sequenceId}
      autoSend={autoSend}
      onAvailable={onAvailable}
      onTakenChange={onTakenChange}
    />
  );
}

const on = (listIds: string[], extra: Partial<StageRuleDraft> = {}): StageRuleDraft => ({ enabled: true, listIds, enrollExisting: false, dirty: false, ...extra });

describe("availability", () => {
  it("renders nothing — and says so — on an account without stages", async () => {
    lists = "forbidden";
    const onAvailable = vi.fn();
    const { container } = render(<Harness onAvailable={onAvailable} />);
    await waitFor(() => expect(onAvailable).toHaveBeenCalledWith(false));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the card when stages exist (archive stages are not offered)", async () => {
    const onAvailable = vi.fn();
    render(<Harness initial={on([])} onAvailable={onAvailable} />);
    expect(await screen.findByText("Auto-enroll by stage")).toBeInTheDocument();
    expect(onAvailable).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("option", { name: "Archived" })).toBeNull();
    expect(screen.getByRole("option", { name: "Applications" })).toBeInTheDocument();
  });
});

describe("choosing stages", () => {
  it("unticked: no picker; ticking marks the card as touched", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ });
    expect(screen.queryByText(/When a lead enters any of these stages/)).toBeNull();
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, listIds: [], enrollExisting: false, dirty: true });
    expect(screen.getByText(/Choose at least one stage/)).toBeInTheDocument();
  });

  it("adds a stage from the picker as a chip, and removes it with its ✕", async () => {
    render(<Harness initial={on([])} />);
    fireEvent.change(await screen.findByLabelText("Add a stage"), { target: { value: QUALIFIED } });
    expect(await screen.findByText("Qualified", { selector: "span" })).toBeInTheDocument();
    // already-chosen stages leave the picker
    expect(screen.queryByRole("option", { name: "Qualified" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Qualified" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove Qualified" })).toBeNull());
  });

  it("unticking clears the catch-up choice", async () => {
    const onChange = vi.fn();
    render(<Harness initial={on([QUALIFIED], { enrollExisting: true })} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ }));
    expect(onChange).toHaveBeenLastCalledWith({ enabled: false, listIds: [QUALIFIED], enrollExisting: false, dirty: true });
  });

  it("the summary names the chosen stages and the rules in plain words", async () => {
    render(<Harness initial={on([QUALIFIED, PROSPECTS])} />);
    expect(await screen.findByText(/including leads from forms and imports/)).toHaveTextContent("Qualified or Prospects");
    expect(screen.getByText(/never gets it twice/)).toBeInTheDocument();
  });

  it("uses SMS wording for a text sequence", async () => {
    render(<Harness initial={on([QUALIFIED])} channel="sms" />);
    expect(await screen.findByText(/including leads from forms and imports/)).toHaveTextContent("start this SMS sequence");
  });
});

describe("a stage another sequence already holds", () => {
  const rule = (over: Record<string, unknown> = {}) => ({ listId: QUALIFIED, listName: "Qualified", sequenceId: "seq-other", sequenceName: "Qualified nudge", channel: "email", ...over });

  it("warns, names the other sequence, and reports it (the warning is the confirmation to replace)", async () => {
    rules = [rule()];
    const onTakenChange = vi.fn();
    render(<Harness initial={on([QUALIFIED])} onTakenChange={onTakenChange} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("“Qualified nudge”");
    await waitFor(() => expect(onTakenChange).toHaveBeenLastCalledWith(true));
  });

  it("no warning for this sequence's OWN rule, for the other channel, or for a stage that isn't chosen", async () => {
    rules = [rule({ sequenceId: "seq-me" }), rule({ channel: "sms" }), rule({ listId: PROSPECTS, listName: "Prospects" })];
    const onTakenChange = vi.fn();
    render(<Harness initial={on([QUALIFIED])} sequenceId="seq-me" onTakenChange={onTakenChange} />);
    await screen.findByText("Auto-enroll by stage");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/v1/outreach/stage-triggers"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onTakenChange).toHaveBeenLastCalledWith(false);
  });

  it("takenByOthers filters exactly like that", () => {
    const all = [rule() as never, rule({ sequenceId: "seq-me" }) as never, rule({ channel: "sms" }) as never] as Parameters<typeof takenByOthers>[0];
    expect(takenByOthers(all, "email", "seq-me", [QUALIFIED])).toHaveLength(1);
    expect(takenByOthers(all, "email", null, [QUALIFIED])).toHaveLength(2);
    expect(takenByOthers(all, "email", "seq-me", [PROSPECTS])).toHaveLength(0);
  });
});

describe("enroll the leads already in the stages", () => {
  it("offers it with the count; asks for the count of exactly the chosen stages", async () => {
    render(<Harness initial={on([QUALIFIED, PROSPECTS])} />);
    expect(await screen.findByLabelText(/Also enroll the 412 leads already in these stages/)).toBeInTheDocument();
    expect(countUrls[0]).toContain(`count_list_ids=${encodeURIComponent(`${QUALIFIED},${PROSPECTS}`)}`);
  });

  it("is not offered when nobody is there yet, or when the server withholds the count (non-admin)", async () => {
    leadsInStages = 0;
    const { unmount } = render(<Harness initial={on([QUALIFIED])} />);
    await screen.findByText("Auto-enroll by stage");
    await waitFor(() => expect(countUrls.length).toBeGreaterThan(0));
    expect(screen.queryByLabelText(/Also enroll/)).toBeNull();
    unmount();
    leadsInStages = null;
    render(<Harness initial={on([QUALIFIED])} />);
    await screen.findByText("Auto-enroll by stage");
    expect(screen.queryByLabelText(/Also enroll/)).toBeNull();
  });

  it("warns about the review backlog only when ticked AND Auto-send is off", async () => {
    const first = render(<Harness initial={on([QUALIFIED], { enrollExisting: true })} autoSend={false} />);
    expect(await screen.findByText(/creates up to 412 drafts for someone to review/)).toBeInTheDocument();
    expect(screen.getByText(/Turn on Auto-send above/)).toBeInTheDocument();
    first.unmount();
    render(<Harness initial={on([QUALIFIED], { enrollExisting: true })} autoSend />);
    await screen.findByLabelText(/Also enroll the 412 leads/);
    expect(screen.queryByText(/for someone to review/)).toBeNull();
  });

  it("singular wording for one lead", async () => {
    leadsInStages = 1;
    render(<Harness initial={on([QUALIFIED])} />);
    expect(await screen.findByLabelText(/Also enroll the 1 lead already in this stage/)).toBeInTheDocument();
  });
});
