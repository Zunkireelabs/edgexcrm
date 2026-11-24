// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ContactPanel } from "./ContactPanel";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const conv = (over: Row = {}): Row => ({
  id: "c1", provider: "chatwoot", status: "open", contact_display_name: "Ram Sharma", contact_phone: null,
  lead_id: null, assignee_type: "unassigned", assigned_to_user_id: null, ...over,
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ user_id: "u1", name: "Manish", email: "m@x.com" }] }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (c: Row, role = "admin", ownerName: string | null = "Manish") =>
  render(<ContactPanel conversation={c} tenantId="t" userRole={role} onConversationUpdate={vi.fn()} ownerName={ownerName} />);

describe("ContactPanel on a website chat", () => {
  it("shows who handles it as plain text, with no free owner picker (even for an admin)", async () => {
    const { container } = show(conv({ assignee_type: "human", assigned_to_user_id: "u1" }));
    await waitFor(() => expect(screen.getByText("Handled by")).toBeInTheDocument());
    expect(container.querySelector("[data-handled-by]")).toHaveTextContent("Manish");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Assigned to")).toBeNull();
  });
  it("says it is waiting to be accepted when nobody has it", () => {
    const { container } = show(conv());
    expect(container.querySelector("[data-handled-by]")).toHaveTextContent("Waiting to be accepted");
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("falls back to 'A teammate' when the owner's name isn't known", () => {
    const { container } = show(conv({ assignee_type: "human", assigned_to_user_id: "u1" }), "staff", null);
    expect(container.querySelector("[data-handled-by]")).toHaveTextContent("A teammate");
  });
});

describe("ContactPanel on other channels is unchanged", () => {
  it("an admin still gets the free 'Assigned to' picker on WhatsApp", async () => {
    show(conv({ provider: "whatsapp", assignee_type: "human", assigned_to_user_id: "u1" }));
    await waitFor(() => expect(screen.getByText("Assigned to")).toBeInTheDocument());
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByText("Handled by")).toBeNull();
  });
});

describe("ContactPanel: who may turn a chat into a lead, and linked leads that are hidden", () => {
  const unlinked = (over: Row = {}) => conv({ lead_id: null, ...over });
  const panel = (c: Row, canManage?: boolean) =>
    render(<ContactPanel conversation={c} tenantId="t" userRole="staff" onConversationUpdate={vi.fn()} ownerName="Manish" canManage={canManage} />);

  it("the person handling an unlinked website chat can convert it", () => {
    panel(unlinked(), true);
    expect(screen.getByRole("button", { name: /Convert to lead/ })).toBeInTheDocument();
  });
  it("someone who isn't handling it can't, and is told why", () => {
    const { container } = panel(unlinked({ assignee_type: "human", assigned_to_user_id: "u1" }), false);
    expect(screen.queryByRole("button", { name: /Convert to lead/ })).toBeNull();
    expect(container.querySelector("[data-accept-first]")).toHaveTextContent("Only the person handling this chat can turn it into a lead");
  });
  it("other channels keep the Convert button by default", () => {
    panel(unlinked({ provider: "whatsapp" }));
    expect(screen.getByRole("button", { name: /Convert to lead/ })).toBeInTheDocument();
  });
  it("a chat linked to a lead the viewer can't open says so, and NEVER offers to create a duplicate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
    const { container } = panel(conv({ lead_id: "lead-someone-elses" }), true);
    await waitFor(() => expect(container.querySelector("[data-linked-hidden]")).toHaveTextContent("Linked to a lead owned by someone else"));
    expect(screen.queryByRole("button", { name: /Convert to lead/ })).toBeNull();
  });
});
