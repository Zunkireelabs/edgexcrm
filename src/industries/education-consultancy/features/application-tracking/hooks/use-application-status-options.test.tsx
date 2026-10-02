// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ApplicationStage } from "@/types/database";
import { useApplicationStatusOptions } from "./use-application-status-options";

const stage = (id: string, name: string, is_default = false): ApplicationStage =>
  ({ id, name, is_default, pipeline_id: "p", tenant_id: "t", slug: id, position: 1, color: "#000", is_terminal: false, terminal_type: null, created_at: "", updated_at: "" }) as ApplicationStage;

const ALL = [stage("all-1", "Shortlisted"), stage("all-2", "Shortlisted"), stage("all-3", "Shortlisted")]; // the old, repeated list
const CANADA = [stage("ca-1", "Shortlisted", true), stage("ca-2", "Documents Pending")];
const UK = [stage("uk-1", "Applied", true)];

let fetchMock: ReturnType<typeof vi.fn>;
let respond: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

beforeEach(() => {
  respond = async (url) => {
    if (url.includes("country=Canada")) return { ok: true, json: async () => ({ data: CANADA }) };
    if (url.includes("country=UK")) return { ok: true, json: async () => ({ data: UK }) };
    return { ok: true, json: async () => ({ data: ALL.slice(0, 1) }) }; // default pipeline
  };
  fetchMock = vi.fn((url: string) => respond(url));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe({ country, enabled = true }: { country?: string; enabled?: boolean }) {
  const { stages, loading } = useApplicationStatusOptions(country, enabled, ALL);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="ids">{stages.map((s) => s.id).join(",")}</span>
    </div>
  );
}
const ids = () => screen.getByTestId("ids").textContent;
const calls = () => fetchMock.mock.calls.map(([url]) => String(url));

describe("useApplicationStatusOptions", () => {
  it("asks for the selected country's statuses only and shows just those", async () => {
    render(<Probe country="Canada" />);
    await waitFor(() => expect(ids()).toBe("ca-1,ca-2"));
    expect(calls()).toEqual(["/api/v1/application-stages?country=Canada"]);
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("asks with an empty country while no destination is chosen (the server then uses the default pipeline)", async () => {
    render(<Probe />);
    await waitFor(() => expect(calls()).toEqual(["/api/v1/application-stages?country="]));
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
  });

  it("URL-encodes the country name", async () => {
    render(<Probe country="Hong Kong & Macau" />);
    await waitFor(() => expect(calls()[0]).toBe("/api/v1/application-stages?country=Hong%20Kong%20%26%20Macau"));
  });

  it("shows the full fallback list, and reports loading, until the answer arrives", async () => {
    let release: (v: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    respond = () => new Promise((resolve) => { release = resolve; });
    render(<Probe country="Canada" />);

    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(ids()).toBe("all-1,all-2,all-3");

    release({ ok: true, json: async () => ({ data: CANADA }) });
    await waitFor(() => expect(ids()).toBe("ca-1,ca-2"));
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("reloads when the destination changes", async () => {
    const { rerender } = render(<Probe country="Canada" />);
    await waitFor(() => expect(ids()).toBe("ca-1,ca-2"));

    rerender(<Probe country="UK" />);
    await waitFor(() => expect(ids()).toBe("uk-1"));
    expect(calls()).toEqual(["/api/v1/application-stages?country=Canada", "/api/v1/application-stages?country=UK"]);
  });

  it("ignores a slow answer for a previous destination (no stale list)", async () => {
    const pending: Record<string, (v: { ok: boolean; json: () => Promise<unknown> }) => void> = {};
    respond = (url) => new Promise((resolve) => { pending[url.split("country=")[1]] = resolve; });

    const { rerender } = render(<Probe country="Canada" />);
    rerender(<Probe country="UK" />);
    pending["UK"]({ ok: true, json: async () => ({ data: UK }) });
    await waitFor(() => expect(ids()).toBe("uk-1"));

    pending["Canada"]({ ok: true, json: async () => ({ data: CANADA }) }); // arrives late
    await new Promise((r) => setTimeout(r, 20));
    expect(ids()).toBe("uk-1");
  });

  it("falls back to the full list when the request fails, so the form is never empty", async () => {
    respond = async () => ({ ok: false, json: async () => ({}) });
    render(<Probe country="Canada" />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(ids()).toBe("all-1,all-2,all-3");
  });

  it("falls back to the full list when the server returns no statuses", async () => {
    respond = async () => ({ ok: true, json: async () => ({ data: [] }) });
    render(<Probe country="Canada" />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(ids()).toBe("all-1,all-2,all-3");
  });

  it("does not fetch while the form is closed", () => {
    render(<Probe country="Canada" enabled={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });
});
