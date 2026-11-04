// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ApplicationsGateDialog } from "./applications-gate-dialog";

afterEach(cleanup);

describe("ApplicationsGateDialog", () => {
  it("lists every missing item in a pop-up", () => {
    render(<ApplicationsGateDialog missing={["Processing fee", "Basic info (Name, a document)", "Consent signed"]} onClose={() => {}} />);
    expect(screen.getByText(/Can.t move to Applications yet/)).toBeInTheDocument();
    expect(screen.getByText("Processing fee")).toBeInTheDocument();
    expect(screen.getByText("Basic info (Name, a document)")).toBeInTheDocument();
    expect(screen.getByText("Consent signed")).toBeInTheDocument();
  });
  it("is closed when nothing is missing-state (null)", () => {
    render(<ApplicationsGateDialog missing={null} onClose={() => {}} />);
    expect(screen.queryByText(/Can.t move to Applications yet/)).toBeNull();
  });
  it("closes via Got it", () => {
    const onClose = vi.fn();
    render(<ApplicationsGateDialog missing={["Consent signed"]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ApplicationsGateDialog — Edit profile", () => {
  it("shows an Edit profile button only when a handler is given, and calls it", () => {
    const onEdit = vi.fn();
    render(<ApplicationsGateDialog missing={["Basic info (Name)"]} onClose={() => {}} onEditProfile={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(onEdit).toHaveBeenCalled();
    cleanup();
    render(<ApplicationsGateDialog missing={["Consent signed"]} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
  });
});
