// @vitest-environment jsdom

import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CollapsibleGroups, EditableField, SectionGroup } from "./form-primitives";

afterEach(cleanup);

describe("SectionGroup", () => {
  it("is a plain heading outside <CollapsibleGroups> (e.g. in the dialog)", () => {
    render(
      <SectionGroup title="Personal Information">
        <p>Basic Details</p>
      </SectionGroup>
    );

    expect(screen.getByRole("heading", { name: "Personal Information" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Basic Details")).toBeInTheDocument();
  });

  it("collapses and expands inside <CollapsibleGroups>, starting open", () => {
    render(
      <CollapsibleGroups>
        <SectionGroup title="Personal Information">
          <p>Basic Details</p>
        </SectionGroup>
      </CollapsibleGroups>
    );

    const toggle = screen.getByRole("button", { name: "Personal Information" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Basic Details")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Basic Details")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Basic Details")).toBeInTheDocument();
  });

  it("collapses each group independently, and any group added later is collapsible too", () => {
    render(
      <CollapsibleGroups>
        <SectionGroup title="Personal Information"><p>Personal body</p></SectionGroup>
        <SectionGroup title="Financial Information"><p>Financial body</p></SectionGroup>
        <SectionGroup title="Some Future Section"><p>Future body</p></SectionGroup>
      </CollapsibleGroups>
    );

    fireEvent.click(screen.getByRole("button", { name: "Financial Information" }));

    expect(screen.queryByText("Financial body")).not.toBeInTheDocument();
    expect(screen.getByText("Personal body")).toBeInTheDocument();
    expect(screen.getByText("Future body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Some Future Section" }));
    expect(screen.queryByText("Future body")).not.toBeInTheDocument();
  });
});

describe("EditableField as a dropdown", () => {
  const field = { key: "medium", label: "Source Channel", type: "select", options: [{ value: "check_in", label: "Check-in" }] } as const;

  it("read-only shows the option's readable name, and an unlisted older value as it was typed", () => {
    const { rerender } = render(<EditableField field={field} isEditing={false} value="check_in" onChange={() => {}} />);
    expect(screen.getByText("Check-in")).toBeInTheDocument();
    rerender(<EditableField field={field} isEditing={false} value="Facebook" onChange={() => {}} />);
    expect(screen.getByText("Facebook")).toBeInTheDocument();
  });

  it("read-only with nothing stored shows a dash", () => {
    render(<EditableField field={field} isEditing={false} value="" onChange={() => {}} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("without onAddOption there is no add row or box", () => {
    render(<EditableField field={field} isEditing value="check_in" onChange={() => {}} />);
    expect(screen.queryByPlaceholderText("New option name")).not.toBeInTheDocument();
  });
});

describe("EditableField dropdown: + Add new option", () => {
  const field = { key: "account", label: "Source Page / Account", type: "select", options: [{ value: "tiktok", label: "TikTok" }] } as const;

  // Radix Select needs a few browser APIs jsdom does not have.
  beforeAll(() => {
    const proto = Element.prototype as unknown as Record<string, unknown>;
    proto.hasPointerCapture ??= () => false;
    proto.setPointerCapture ??= () => {};
    proto.releasePointerCapture ??= () => {};
    proto.scrollIntoView ??= () => {};
  });

  const openAndChooseAdd = async () => {
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "+ Add new option…" }));
  };

  it("choosing the add row opens a name box; Add saves it and picks the new option", async () => {
    const onAddOption = vi.fn(async () => "viber");
    const onChange = vi.fn();
    render(<EditableField field={field} isEditing value="" onChange={onChange} onAddOption={onAddOption} />);
    await openAndChooseAdd();
    const box = await screen.findByPlaceholderText("New option name");
    fireEvent.change(box, { target: { value: "  Viber " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("viber"));
    expect(onAddOption).toHaveBeenCalledWith("Viber");
    expect(screen.queryByPlaceholderText("New option name")).not.toBeInTheDocument();
  });

  it("a refused add leaves the box open and picks nothing", async () => {
    const onAddOption = vi.fn(async () => null);
    const onChange = vi.fn();
    render(<EditableField field={field} isEditing value="" onChange={onChange} onAddOption={onAddOption} />);
    await openAndChooseAdd();
    fireEvent.change(await screen.findByPlaceholderText("New option name"), { target: { value: "Viber" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onAddOption).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("New option name")).toBeInTheDocument();
  });

  it("Cancel closes the box without saving; the add row itself is never stored as the value", async () => {
    const onAddOption = vi.fn(async () => "x");
    const onChange = vi.fn();
    render(<EditableField field={field} isEditing value="" onChange={onChange} onAddOption={onAddOption} />);
    await openAndChooseAdd();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("New option name")).not.toBeInTheDocument();
    expect(onAddOption).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("EditableField text box: onBlur and warning", () => {
  const field = { key: "email", label: "Email", type: "email" } as const;

  it("calls onBlur when the person leaves the box", () => {
    const onBlur = vi.fn();
    render(<EditableField field={field} isEditing value="a@b.com" onChange={() => {}} onBlur={onBlur} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("shows a warning under the box while editing, and nothing without one", () => {
    const { rerender } = render(<EditableField field={field} isEditing value="a@b.com" onChange={() => {}} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<EditableField field={field} isEditing value="a@b.com" onChange={() => {}} warning="Another lead already has this email." />);
    expect(screen.getByRole("status")).toHaveTextContent("Another lead already has this email.");
  });

  it("without onBlur or warning it renders exactly as before", () => {
    render(<EditableField field={field} isEditing value="a@b.com" onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("a@b.com");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
