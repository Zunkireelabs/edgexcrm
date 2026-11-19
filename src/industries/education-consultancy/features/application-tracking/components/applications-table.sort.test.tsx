// @vitest-environment jsdom
//
// Client request (Manish / Admizz, Nov 2026): every Applications column header is a sort control.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { ApplicationsTable } from "./applications-table";
import type { Application } from "@/types/database";

afterEach(cleanup);

const apps = [
  { id: "a1", lead_id: "l1", university_name: "Oxford", program_name: "Law", intake_term: "May 2026", countries: [], status: "applied", stage_id: null, application_deadline: null, leads: { id: "l1", first_name: "Ann", last_name: "Lee", email: null } },
] as unknown as Application[];

const HEADERS = ["Student", "University", "Program", "Intake", "Country", "Status", "Deadline"];

describe("ApplicationsTable — sortable column headers", () => {
  it("without onSort the headers are plain text (unchanged behaviour)", () => {
    render(<ApplicationsTable applications={apps} stages={[]} />);
    for (const h of HEADERS) expect(screen.queryByRole("button", { name: new RegExp(h, "i") })).toBeNull();
    expect(screen.getByText("University")).toBeInTheDocument();
  });

  it("with onSort every shown column header is a button that reports its sort field", () => {
    const onSort = vi.fn();
    render(<ApplicationsTable applications={apps} stages={[]} sortField="created_at" sortDir="desc" onSort={onSort} />);

    const expected: Record<string, string> = {
      Student: "student", University: "university_name", Program: "program", Intake: "intake",
      Country: "country", Status: "status", Deadline: "application_deadline",
    };
    for (const [label, field] of Object.entries(expected)) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") }));
      expect(onSort).toHaveBeenLastCalledWith(field);
    }
    expect(onSort).toHaveBeenCalledTimes(7);
  });

  it("marks the active column with aria-sort and leaves the rest 'none'", () => {
    render(<ApplicationsTable applications={apps} stages={[]} sortField="intake" sortDir="asc" onSort={vi.fn()} />);
    expect(screen.getByRole("columnheader", { name: /intake/i })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: /university/i })).toHaveAttribute("aria-sort", "none");
  });

  it("descending is reported as aria-sort=descending", () => {
    render(<ApplicationsTable applications={apps} stages={[]} sortField="student" sortDir="desc" onSort={vi.fn()} />);
    expect(screen.getByRole("columnheader", { name: /student/i })).toHaveAttribute("aria-sort", "descending");
  });

  it("only the columns the user has switched on are sortable buttons", () => {
    render(<ApplicationsTable applications={apps} stages={[]} visibleKeys={["university"]} sortField="created_at" sortDir="desc" onSort={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^student$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^university$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^program$/i })).toBeNull();
  });
});
