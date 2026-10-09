// @vitest-environment jsdom
//
// Client request (Student Details > Passport & Citizenship): passport and citizenship fields must not
// mix. Each document: the number alone on one line, its detail boxes together on the next.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PERSONAL_DETAIL_COLUMNS } from "@/lib/leads/personal-details";
import { IDENTITY_DOCUMENT_GROUPS, IDENTITY_DOCUMENT_KEYS, IdentityDocumentFields } from "./identity-document-fields";

afterEach(cleanup);

describe("identity document groups", () => {
  it("keeps exactly the seven original fields — none lost, renamed, or added", () => {
    expect([...IDENTITY_DOCUMENT_KEYS].sort()).toEqual(
      [
        "citizenship_issued_by", "citizenship_issued_date", "citizenship_number",
        "passport_expiry_date", "passport_issued_by", "passport_issued_date", "passport_number",
      ],
    );
  });

  it("only edits real saved columns", () => {
    const saved = new Set<string>(PERSONAL_DETAIL_COLUMNS);
    for (const key of IDENTITY_DOCUMENT_KEYS) expect(saved.has(key), key).toBe(true);
  });

  it("puts the number first, then 3 passport details and 2 citizenship details", () => {
    const [passport, citizenship] = IDENTITY_DOCUMENT_GROUPS;
    expect(passport.number.label).toBe("Passport Number");
    expect(passport.details.map((d) => d.label)).toEqual(["Passport Issued By", "Passport Issued Date", "Passport Expiry Date"]);
    expect(citizenship.number.label).toBe("Citizenship Number");
    expect(citizenship.details.map((d) => d.label)).toEqual(["Citizenship Issued By", "Citizenship Issued Date"]);
  });

  it("never mixes the two documents: every passport field is in the passport group and vice versa", () => {
    for (const g of IDENTITY_DOCUMENT_GROUPS) {
      for (const f of [g.number, ...g.details]) expect(f.key.startsWith(g.id)).toBe(true);
    }
  });
});

describe("IdentityDocumentFields", () => {
  it("renders Passport then Citizenship, each with its own fields", () => {
    const { container } = render(<IdentityDocumentFields isEditing values={{}} onChange={() => {}} />);
    const groups = container.querySelectorAll("[data-document-group]");
    expect([...groups].map((g) => g.getAttribute("data-document-group"))).toEqual(["passport", "citizenship"]);
    const passport = within(groups[0] as HTMLElement);
    const citizenship = within(groups[1] as HTMLElement);
    for (const l of ["Passport Number", "Passport Issued By", "Passport Issued Date", "Passport Expiry Date"]) {
      expect(passport.getAllByText(l, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(passport.queryByText(/Citizenship/)).toBeNull();
    for (const l of ["Citizenship Number", "Citizenship Issued By", "Citizenship Issued Date"]) {
      expect(citizenship.getAllByText(l, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(citizenship.queryByText(/Passport/)).toBeNull();
  });

  it("puts each number on a line of its own, before its detail boxes", () => {
    const { container } = render(<IdentityDocumentFields isEditing values={{}} onChange={() => {}} />);
    const passport = container.querySelector('[data-document-group="passport"]') as HTMLElement;
    const rows = passport.children; // [number row, details row]
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll("input")).toHaveLength(1);
    expect(rows[1].querySelectorAll("input")).toHaveLength(3);
    const citizenship = container.querySelector('[data-document-group="citizenship"]') as HTMLElement;
    expect(citizenship.children[0].querySelectorAll("input")).toHaveLength(1);
    expect(citizenship.children[1].querySelectorAll("input")).toHaveLength(2);
  });

  it("reports edits against the real column key", () => {
    const onChange = vi.fn();
    render(<IdentityDocumentFields isEditing values={{}} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("Enter passport number"), { target: { value: "PA123" } });
    expect(onChange).toHaveBeenCalledWith("passport_number", "PA123");
    fireEvent.change(screen.getByPlaceholderText("Enter citizenship number"), { target: { value: "99-01" } });
    expect(onChange).toHaveBeenCalledWith("citizenship_number", "99-01");
  });

  it("shows saved values read-only", () => {
    render(<IdentityDocumentFields isEditing={false} values={{ passport_number: "PA123", citizenship_number: "99-01" }} />);
    expect(screen.getByText("PA123")).toBeInTheDocument();
    expect(screen.getByText("99-01")).toBeInTheDocument();
  });
});
