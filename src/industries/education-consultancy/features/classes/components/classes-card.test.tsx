// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ClassesCard } from "./classes-card";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/permission-denied";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));

describe("ClassesCard", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    toastError.mockClear();
  });

  it("shows the genuine empty state when the fetch succeeds with zero enrollments", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) } as Response);
    render(<ClassesCard leadId="lead-1" canManage={false} />);
    await waitFor(() => expect(screen.getByText("Not enrolled in any class yet.")).toBeInTheDocument());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("REGRESSION (the actual prod bug): a failed fetch (404/500/network error) must NOT render as the same empty state as a real empty list", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { message: "Lead not found" } }) } as Response);
    render(<ClassesCard leadId="lead-1" canManage={false} />);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByText("Not enrolled in any class yet.")).not.toBeInTheDocument();
  });

  it("renders real enrollments when the fetch succeeds with data", async () => {
    const enrollment = {
      id: "enr-1",
      class_id: "class-1",
      fee_paid: true,
      fee_amount: 4000,
      enrollment_type: "actual",
      status: "active",
      created_at: new Date().toISOString(),
      classes: { id: "class-1", name: "IELTS Physical", default_fee: 4000 },
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [enrollment] }) } as Response);
    render(<ClassesCard leadId="lead-1" canManage={false} />);
    await waitFor(() => expect(screen.getByText("IELTS Physical")).toBeInTheDocument());
  });
  describe("a refused action shows the right message", () => {
    const enrollment = {
      id: "enr-1",
      class_id: "class-1",
      fee_paid: true,
      fee_amount: 4000,
      enrollment_type: "actual",
      status: "active",
      created_at: new Date().toISOString(),
      classes: { id: "class-1", name: "IELTS Physical", default_fee: 4000 },
    };

    async function clickMarkUnpaidWithPatchStatus(status: number) {
      global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return { ok: false, status, json: async () => ({ error: { message: "x" } }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({ data: [enrollment] }) } as Response;
      }) as typeof fetch;
      render(<ClassesCard leadId="lead-1" canManage />);
      await waitFor(() => expect(screen.getByText("IELTS Physical")).toBeInTheDocument());
      const trigger = document.querySelector("button[aria-haspopup='menu']") as HTMLElement;
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.click(await screen.findByText("Mark unpaid"));
    }

    it("shows the standard no-permission message on 403", async () => {
      await clickMarkUnpaidWithPatchStatus(403);
      await waitFor(() => expect(toastError).toHaveBeenCalledWith(PERMISSION_DENIED_MESSAGE));
    });

    it("keeps the normal failure message for other errors", async () => {
      await clickMarkUnpaidWithPatchStatus(500);
      await waitFor(() => expect(toastError).toHaveBeenCalledWith("Failed to update enrollment"));
    });
  });
});
