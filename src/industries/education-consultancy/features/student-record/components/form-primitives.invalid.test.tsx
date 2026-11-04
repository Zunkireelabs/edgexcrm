// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EditableField } from "./form-primitives";

afterEach(cleanup);

const field = { key: "email", label: "Email", type: "email" };

describe("EditableField invalid (required before Applications)", () => {
  it("marks the label and input red when invalid", () => {
    render(<EditableField field={field} isEditing value="" onChange={() => {}} invalid />);
    expect(screen.getByText(/Email — required/)).toHaveClass("text-red-600");
    expect(screen.getByPlaceholderText("Enter email").className).toContain("border-red-500");
  });
  it("looks normal when not invalid", () => {
    const { container } = render(<EditableField field={field} isEditing value="" onChange={() => {}} />);
    expect(container.querySelector("p")).not.toHaveClass("text-red-600");
    expect(screen.getByPlaceholderText("Enter email").className).not.toContain("border-red-500");
  });
});
