// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// The form itself is not under test here — only whether the card opens it.
vi.mock("./add-application-to-lead-sheet", () => ({
  AddApplicationToLeadSheet: ({ open }: { open: boolean }) => (open ? <div>ADD APPLICATION FORM IS OPEN</div> : null),
}));

import { ApplicationsCard } from "./applications-card";

type Completeness = { ok: boolean; data?: { complete: boolean; missing: string[] } } | "network-error";
let completeness: Completeness;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  completeness = { ok: true, data: { complete: true, missing: [] } };
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/profile-completeness")) {
      const answer = completeness;
      if (answer === "network-error") throw new Error("offline");
      return { ok: answer.ok, status: answer.ok ? 200 : 500, json: async () => ({ data: answer.data }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) }; // applications list + stages
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const profileChecks = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/profile-completeness"));

async function renderCard(disabled = false) {
  render(<ApplicationsCard leadId="lead-1" canManage disabled={disabled} />);
  await screen.findByText("No applications yet.");
}

describe("ApplicationsCard — profile check before the form opens", () => {
  it("shows a big pop-up listing what is missing, and does NOT open the form, when the profile is incomplete", async () => {
    completeness = { ok: true, data: { complete: false, missing: ["Email", "a document"] } };
    await renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Add Application" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Complete the student profile first")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("a document")).toBeInTheDocument();
    expect(screen.queryByText("ADD APPLICATION FORM IS OPEN")).not.toBeInTheDocument();
  });

  it("opens the form when the profile is complete", async () => {
    await renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Add Application" }));

    expect(await screen.findByText("ADD APPLICATION FORM IS OPEN")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("still opens the form when the check cannot run (the create API enforces the rule anyway)", async () => {
    completeness = "network-error";
    await renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Add Application" }));
    expect(await screen.findByText("ADD APPLICATION FORM IS OPEN")).toBeInTheDocument();
  });

  it("also opens the form when the check answers with an error status", async () => {
    completeness = { ok: false };
    await renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Add Application" }));
    expect(await screen.findByText("ADD APPLICATION FORM IS OPEN")).toBeInTheDocument();
  });

  it("does nothing — and does not even check — while the button is blocked (consent not signed)", async () => {
    await renderCard(true);

    const button = screen.getByRole("button", { name: "Add Application (sign consent first)" });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => expect(profileChecks()).toHaveLength(0));
    expect(screen.queryByText("ADD APPLICATION FORM IS OPEN")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("checks once per click", async () => {
    await renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Add Application" }));
    await screen.findByText("ADD APPLICATION FORM IS OPEN");
    expect(profileChecks()).toHaveLength(1);
  });
});
