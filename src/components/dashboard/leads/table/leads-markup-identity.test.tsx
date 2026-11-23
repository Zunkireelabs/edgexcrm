// @vitest-environment jsdom

// EDGEX-141 Phase 4 guard: the Applications List reuses parts of the Leads v2 grid (shared style
// tokens, the column menu, View settings, pagination). Leads must render byte-identical markup.
// The hashes below were recorded on the commit BEFORE those parts were shared (29fde16c); any change
// to what Leads renders fails this test.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import type { Lead } from "@/types/database";
import { UserIcon } from "@/components/icons";
import type { LeadColumn, LeadColumnCtx } from "../columns-registry";
import { LeadsGrid } from "./leads-grid";
import { GridPagination } from "./grid-pagination";
import { ColumnHeaderMenu } from "./column-header-menu";
import { ColumnsPopover } from "./columns-popover";
import { BulkBar, getBulkBarActions } from "./bulk-bar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

afterEach(cleanup);

// Radix generates ids per mount; they are not part of what Leads "renders".
const normalize = (html: string) => html.replace(/(id|aria-controls|aria-labelledby|aria-describedby|for)="[^"]*(radix|«|:r)[^"]*"/g, '$1=""');
const sha = (html: string) => createHash("sha256").update(normalize(html)).digest("hex").slice(0, 16);

const col = (key: string, label: string, extra: Partial<LeadColumn["v2"]> = {}): LeadColumn =>
  ({
    key,
    label,
    group: "standard",
    renderTh: () => label,
    renderTd: (l: Lead) => String((l as unknown as Record<string, unknown>)[key] ?? ""),
    v2: { label, icon: UserIcon, width: 150, cell: (l: Lead) => <span>{String((l as unknown as Record<string, unknown>)[key] ?? "—")}</span>, ...extra },
  }) as unknown as LeadColumn;

const nameColumn = col("name", "Name", { cell: (l: Lead) => <span>{l.first_name} {l.last_name}</span> });
const columns = [col("email", "Email", { sort: "email", filterFieldKey: "email" }), col("assigned", "Counsellor"), col("lead_type", "Stage")];
const leads = [
  { id: "l1", first_name: "Asha", last_name: "Rai", email: "a@x.test" },
  { id: "l2", first_name: "Binod", last_name: "Lama", email: "b@x.test" },
] as unknown as Lead[];
const ctx = { onPreviewToggle: () => {} } as unknown as LeadColumnCtx;

describe("Leads v2 grid markup is unchanged by the Applications List (EDGEX-141 Phase 4)", () => {
  it("grid: rows, pinned column, selection, sorted header, footer summaries", () => {
    const { container } = render(
      <LeadsGrid
        leads={leads}
        nameColumn={nameColumn}
        columns={columns}
        ctx={ctx}
        layout={{ keys: ["email", "assigned", "lead_type"], pins: ["email"] }}
        widths={{ assigned: 180 }}
        labels={{ lead_type: "Lead stage" }}
        onWidthChange={() => {}}
        onWidthCommit={() => {}}
        onLayoutChange={() => {}}
        onRename={() => {}}
        selectedIds={new Set(["l2"])}
        previewedId={null}
        allSelected={false}
        someSelected
        onToggleSelect={() => {}}
        onToggleSelectAll={() => {}}
        sort={{ field: "email", direction: "asc" }}
        onSort={() => {}}
        filterFieldKeys={new Set(["email"])}
        onFilterRequest={() => {}}
        total={1234}
        counsellors={7}
        stages={4}
        needFollowUp={12}
        loading={false}
        emptyState={<div>empty</div>}
      />,
    );
    expect(sha(container.innerHTML)).toMatchInlineSnapshot(`"c40b4db7432c9b5b"`);
  });

  it("grid: loading skeleton and empty state", () => {
    const loading = render(
      <LeadsGrid
        leads={[]} nameColumn={nameColumn} columns={columns} ctx={ctx} layout={{ keys: ["email"], pins: [] }} widths={{}} labels={{}}
        onWidthChange={() => {}} onWidthCommit={() => {}} onLayoutChange={() => {}} onRename={() => {}} selectedIds={new Set()}
        allSelected={false} someSelected={false} onToggleSelect={() => {}} onToggleSelectAll={() => {}} sort={{ field: "activity", direction: "desc" }}
        onSort={() => {}} filterFieldKeys={new Set()} onFilterRequest={() => {}} total={0} counsellors={null} loading emptyState={<div>empty</div>}
      />,
    );
    expect(sha(loading.container.innerHTML)).toMatchInlineSnapshot(`"803349db2ae01f9c"`);
    cleanup();
    const empty = render(
      <LeadsGrid
        leads={[]} nameColumn={nameColumn} columns={columns} ctx={ctx} layout={{ keys: ["email"], pins: [] }} widths={{}} labels={{}}
        onWidthChange={() => {}} onWidthCommit={() => {}} onLayoutChange={() => {}} onRename={() => {}} selectedIds={new Set()}
        allSelected={false} someSelected={false} onToggleSelect={() => {}} onToggleSelectAll={() => {}} sort={{ field: "activity", direction: "desc" }}
        onSort={() => {}} filterFieldKeys={new Set()} onFilterRequest={() => {}} total={0} counsellors={null} loading={false} emptyState={<div>empty</div>}
      />,
    );
    expect(sha(empty.container.innerHTML)).toMatchInlineSnapshot(`"28f1f3ed491d12cb"`);
  });

  it("pagination", () => {
    const { container } = render(
      <GridPagination total={201} start={25} end={50} page={2} totalPages={9} pageSize={25} onPage={() => {}} onPageSize={() => {}} />,
    );
    expect(sha(container.innerHTML)).toMatchInlineSnapshot(`"7bf36b8f246ce836"`);
  });

  it("column header menu (sortable + filterable + pin/move/rename/hide)", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    render(
      <ColumnHeaderMenu
        anchor={anchor}
        model={{
          key: "email", title: "Email", defaultTitle: "Email", isName: false, sortKey: "email", activeSortDirection: "asc",
          canFilter: true, pinned: false, canPin: true, canMoveLeft: true, canMoveRight: true,
        }}
        onClose={() => {}} onSort={() => {}} onFilter={() => {}} onTogglePin={() => {}} onMove={() => {}} onRename={() => {}} onHide={() => {}}
      />,
    );
    const menu = document.querySelector('[data-testid="column-header-menu"]')!;
    expect(sha(menu.outerHTML)).toMatchInlineSnapshot(`"cc825a8d8b85d7a7"`);
    anchor.remove();
  });

  it("View settings popover (open)", async () => {
    const { getByText } = render(
      <ColumnsPopover
        trigger={<button type="button">View settings</button>}
        columns={columns}
        layout={{ keys: ["email", "lead_type"], pins: ["email"] }}
        titleFor={(c) => c.v2?.label ?? c.label}
        onLayoutChange={() => {}}
        onReset={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(getByText("View settings"));
    });
    const pop = document.querySelector('[data-testid="columns-popover"]')!;
    expect(sha(pop.outerHTML)).toMatchInlineSnapshot(`"bdac6762a571f149"`);
  });

  it("bulk bar", () => {
    const actions = getBulkBarActions({
      viewMode: "normal", isAdmin: true, isTeamScoped: false, selectedCount: 2, teamMemberCount: 3, isStagingView: false, hasOutreach: false,
      showBranches: false, branchCount: 0, canGraduate: false, hasArchiveList: true, pageFullySelected: false, pageCount: 25, effectiveTotal: 100,
      allResultsSelected: false,
    });
    const noop = () => {};
    const { container } = render(
      <BulkBar
        selectedCount={2}
        effectiveTotal={100}
        actions={actions}
        handlers={{
          onMoveStage: noop, onAssign: noop, onAddTag: noop, onArchive: noop, onRestore: noop, onDeleteForever: noop, onEnroll: noop,
          onBranch: noop, onGraduate: noop, onMerge: noop, onDelete: noop, onSelectAllMatching: noop, onClear: noop,
        }}
      />,
    );
    expect(sha(container.innerHTML)).toMatchInlineSnapshot(`"e525ff86916632a9"`);
  });
});
