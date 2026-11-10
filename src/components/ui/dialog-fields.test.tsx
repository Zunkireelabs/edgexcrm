// @vitest-environment jsdom
//
// EDGEX-145: Attio form fields inside dialogs. jsdom can't evaluate globals.css, so this pins the two halves
// separately: (1) the shared field components expose the data-slot hooks the dialog-scoped CSS keys on, and they
// render inside the dialog card; (2) the CSS block carries the measured Attio values.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Input } from "./input";
import { Textarea } from "./textarea";
import { Label } from "./label";

afterEach(cleanup);

describe("dialog form fields", () => {
  it("renders Input / Textarea / Label with the data-slot hooks, inside the dialog card", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
          <Label htmlFor="a">First name</Label>
          <Input id="a" placeholder="John" />
          <Textarea aria-label="Notes" />
        </DialogContent>
      </Dialog>,
    );
    const card = document.querySelector("[data-slot=dialog-card]")!;
    for (const slot of ["input", "textarea", "label"]) {
      expect(card.querySelector(`[data-slot=${slot}]`)).not.toBeNull();
    }
    expect(screen.getByPlaceholderText("John")).toHaveAttribute("data-slot", "input");
  });

  it("globals.css carries the Attio values, scoped to dialogs", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const block = css.slice(css.indexOf("EDGEX-145 Dialogs v1: Attio form fields"));
    expect(block).toContain('[data-slot="dialog-card"]');
    expect(block).toContain("height: 32px");
    expect(block).toContain("border-radius: 9px");
    expect(block).toContain("inset 0 0 0 1px rgba(0, 0, 0, 0.06)");
    expect(block).toContain("border-radius: 10px"); // focus
    expect(block).toContain("inset 0 0 0 1px var(--ds-accent)");
    expect(block).toContain("inset 0 0 0 1px var(--ds-bad)");
    expect(block).toContain("font-size: 12px"); // label + error text
    expect(block).toContain("opacity: 0.5"); // disabled
    expect(block).toContain("margin-bottom: 4px"); // label -> field, deterministic (no negative margin)
    expect(block).not.toContain("margin-bottom: -2px");
    expect(block).toContain('[data-slot="phone-input"]'); // phone is one control
    // never leaks to page forms: the only selector roots in the block are the dialog / alert-dialog card
    const rootless = block.split("\n").filter((l) => /^\S.*\{$/.test(l) && !l.startsWith(":is([data-slot=\"dialog-card\"], [data-slot=\"alert-dialog-card\"])"));
    expect(rootless).toEqual([]);
  });
});
