// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { LogCallDialog, toLocalInput } from "./log-call-dialog";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup() {
  const posted: Record<string, unknown>[] = [];
  global.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body)));
    return { ok: true, status: 201, json: async () => ({ data: { id: "a1" } }) } as Response;
  }) as unknown as typeof fetch;
  const onFollowUp = vi.fn();
  const onLogged = vi.fn();
  render(<LogCallDialog open onOpenChange={() => {}} leadId="l1" leadName="Aarav Shrestha" onLogged={onLogged} onFollowUp={onFollowUp} />);
  return { posted, onFollowUp, onLogged };
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: /^Log call/ }));

describe("Log call", () => {
  it("sends the outcome, duration and notes in today's payload; 'now' sends no time", async () => {
    const { posted, onLogged } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "No answer" }));
    fireEvent.change(screen.getByLabelText("Duration (min)"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Rang twice" } });
    submit();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ activity_type: "call", call_outcome: "no_answer", duration_minutes: 12, subject: "Call - No Answer", description: "Rang twice" });
    expect(posted[0]).not.toHaveProperty("created_at");
    await waitFor(() => expect(onLogged).toHaveBeenCalled());
  });

  it("sends the When as created_at for a call from earlier", async () => {
    const { posted } = setup();
    const earlier = new Date(Date.now() - 26 * 3600_000);
    const local = toLocalInput(earlier);
    fireEvent.click(screen.getByRole("button", { name: /^When:/ }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: local.slice(0, 10) } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: local.slice(11) } });
    submit();
    await waitFor(() => expect(posted).toHaveLength(1));
    const sent = new Date(String(posted[0].created_at)).getTime();
    expect(Math.abs(sent - earlier.getTime())).toBeLessThan(60_000);
  });

  it("refuses a time in the future and sends nothing", async () => {
    const { posted } = setup();
    // Past only: the date input's max is today, but a time later today is still caught here.
    fireEvent.click(screen.getByRole("button", { name: /^When:/ }));
    const later = toLocalInput(new Date(Date.now() + 3 * 3600_000));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: later.slice(0, 10) } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: later.slice(11) } });
    expect(screen.getByRole("alert")).toHaveTextContent(/future/);
    expect(screen.getByRole("button", { name: /^Log call/ })).toBeDisabled();
    expect(posted).toHaveLength(0);
  });

  it("'Also set a follow-up task' opens the task composer after saving", async () => {
    const { onFollowUp } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Also set a follow-up task" }));
    submit();
    await waitFor(() => expect(onFollowUp).toHaveBeenCalledTimes(1));
  });

  it("does not open the composer without the toggle", async () => {
    const { posted, onFollowUp } = setup();
    submit();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(onFollowUp).not.toHaveBeenCalled();
  });
});
