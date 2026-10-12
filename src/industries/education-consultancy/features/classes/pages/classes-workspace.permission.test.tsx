// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/permission-denied";

// Clicking the fee pencil on a student the user may not change must say "no permission" right
// away — the Edit-fee box must not open. `can_edit` comes from the page (same rule as the API).

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/contexts/settings-modal-context", () => ({ useSettingsModal: () => ({ openSettings: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { ClassesWorkspace } from "./classes-workspace";

const classes = [{ id: "c-1", name: "IELTS Online", default_fee: 4000, is_active: true, end_date: null }];

function enrollment(canEdit: boolean | undefined) {
  return {
    id: "enr-1",
    lead_id: "lead-1",
    class_id: "c-1",
    fee_paid: false,
    fee_amount: null,
    enrollment_type: "actual",
    status: "active",
    created_at: "2026-10-02T00:00:00Z",
    can_edit: canEdit,
    leads: { id: "lead-1", first_name: "Rahul", last_name: "Sah", email: "r@x.com", assigned_to: "someone" },
  };
}

function renderWorkspace(canEdit: boolean | undefined) {
  return render(
    <ClassesWorkspace
      classes={classes}
      enrollments={[enrollment(canEdit)] as never}
      canManage={false}
      canEnroll
      canMarkAttendance={false}
      tenantId="t-1"
      canSeeFeesTotals={false}
      feesCollected={null}
      classFeePct={null}
    />,
  );
}

afterEach(() => {
  cleanup();
  toastError.mockClear();
});

describe("Classes workspace — fee pencil", () => {
  it("shows the no-permission message and does not open the box when the user may not edit this student", () => {
    renderWorkspace(false);
    fireEvent.click(screen.getByTitle("Edit fee"));
    expect(toastError).toHaveBeenCalledWith(PERMISSION_DENIED_MESSAGE);
    expect(screen.queryByText("Amount received")).not.toBeInTheDocument();
  });

  it("opens the Edit fee box when the user may edit this student", () => {
    renderWorkspace(true);
    fireEvent.click(screen.getByTitle("Edit fee"));
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByText("Amount received")).toBeInTheDocument();
  });

  it("opens the box when the page did not flag the row (the server stays the safety net)", () => {
    renderWorkspace(undefined);
    fireEvent.click(screen.getByTitle("Edit fee"));
    expect(screen.getByText("Amount received")).toBeInTheDocument();
  });
});
