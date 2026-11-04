// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ListStepper } from "./list-stepper";
import type { LeadList } from "@/types/database";

afterEach(cleanup);

const mk = (id: string, slug: string, name: string, sort: number) =>
  ({ id, slug, name, sort_order: sort, is_archive: false, is_intake: false, is_system: false, color: null, access: { mode: "all" }, pipeline_id: null, tenant_id: "t" }) as unknown as LeadList;
const LISTS = [mk("p", "prospects", "Prospects", 20), mk("a", "applications", "Applications", 30)];

function setup(precheck: (id: string) => Promise<boolean>) {
  render(
    <ListStepper
      currentListId="p"
      activeLists={LISTS}
      accessibleLists={LISTS}
      industryId="education_consultancy"
      onMove={async () => {}}
      onPrecheckNext={precheck}
    />,
  );
}

describe("ListStepper — Applications pre-check on Send to next", () => {
  it("runs the check first and does NOT open the confirm step when something is missing", async () => {
    const precheck = vi.fn(async () => false);
    setup(precheck);
    fireEvent.click(screen.getByRole("button", { name: "Send to Applications" }));
    await waitFor(() => expect(precheck).toHaveBeenCalledWith("a"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the confirm step when the check passes", async () => {
    setup(vi.fn(async () => true));
    fireEvent.click(screen.getByRole("button", { name: "Send to Applications" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
