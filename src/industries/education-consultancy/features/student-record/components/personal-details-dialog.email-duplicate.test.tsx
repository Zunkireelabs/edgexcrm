// @vitest-environment jsdom
//
// Edit profile: leaving the Email box asks whether another lead already has that email, and warns (never blocks). Renders the real dialog.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { PersonalDetailsDialog } from "./personal-details-dialog";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

function renderDialog(emailCheck: unknown, lead: Record<string, unknown> = { email: "old@example.com" }) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes("/email-check") ? { data: emailCheck } : { data: {} }),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  render(
    <PersonalDetailsDialog
      lead={{ id: "lead-1", custom_fields: {}, destinations: [], ...lead } as unknown as Lead}
      open
      onOpenChange={() => {}}
      openInEditMode
    />,
  );
  return fetchMock;
}
const emailCalls = (m: ReturnType<typeof vi.fn>) => m.mock.calls.filter(([u]) => String(u).includes("/email-check"));

describe("Edit profile: email already on another lead", () => {
  it("warns when the person changes the email to one another lead has", async () => {
    const fetchMock = renderDialog({ duplicate: true, count: 1 });
    const box = await screen.findByDisplayValue("old@example.com");
    fireEvent.change(box, { target: { value: "laxmi@example.com" } });
    fireEvent.blur(box);
    expect(await screen.findByText("Another lead already has this email.")).toBeInTheDocument();
    expect(emailCalls(fetchMock)[0][0]).toBe("/api/v1/leads/lead-1/email-check?email=laxmi%40example.com");
  });

  it("an admin's warning names the other lead", async () => {
    renderDialog({ duplicate: true, count: 1, leads: [{ id: "o", display_id: "ADM-17703", name: "Laxmi Bantha" }] });
    const box = await screen.findByDisplayValue("old@example.com");
    fireEvent.change(box, { target: { value: "laxmi@example.com" } });
    fireEvent.blur(box);
    expect(await screen.findByText("Another lead already has this email: ADM-17703 · Laxmi Bantha.")).toBeInTheDocument();
  });

  it("no warning when nobody else has the email", async () => {
    const fetchMock = renderDialog({ duplicate: false, count: 0 });
    const box = await screen.findByDisplayValue("old@example.com");
    fireEvent.change(box, { target: { value: "free@example.com" } });
    fireEvent.blur(box);
    await waitFor(() => expect(emailCalls(fetchMock)).toHaveLength(1));
    expect(screen.queryByText(/already has this email/)).not.toBeInTheDocument();
  });

  it("leaving the box with the email unchanged does not ask", async () => {
    const fetchMock = renderDialog({ duplicate: true, count: 1 });
    const box = await screen.findByDisplayValue("old@example.com");
    fireEvent.blur(box);
    expect(emailCalls(fetchMock)).toHaveLength(0);
    expect(screen.queryByText(/already has this email/)).not.toBeInTheDocument();
  });

  it("typing again removes the warning until the person leaves the box again", async () => {
    renderDialog({ duplicate: true, count: 1 });
    const box = await screen.findByDisplayValue("old@example.com");
    fireEvent.change(box, { target: { value: "laxmi@example.com" } });
    fireEvent.blur(box);
    await screen.findByText("Another lead already has this email.");
    fireEvent.change(box, { target: { value: "laxmi2@example.com" } });
    expect(screen.queryByText("Another lead already has this email.")).not.toBeInTheDocument();
  });
});
