// Client request (Manish, Nov 2026): an archived lead that re-registers must come back to "New" so staff see it.
// pickReviveTarget is pure (no DB): it decides whether to move the lead and where.
import { describe, it, expect } from "vitest";
import { pickReviveTarget, type ReviveList } from "./revive-archived";

const ARCHIVE: ReviveList = { id: "arch", name: "Archive", slug: "archive", is_archive: true, is_intake: false };
const NEW: ReviveList = { id: "new", name: "New Leads", slug: "new-leads", is_archive: false, is_intake: true };
const PRE: ReviveList = { id: "pre", name: "Pre-qualified", slug: "pre-qualified", is_archive: false, is_intake: false };
const PROSPECTS: ReviveList = { id: "pros", name: "Prospects", slug: "prospects", is_archive: false, is_intake: false };
const LISTS = [ARCHIVE, NEW, PRE, PROSPECTS];

describe("pickReviveTarget", () => {
  it("an archived lead goes to the intake (New) list", () => {
    expect(pickReviveTarget({ currentListId: "arch", formTargetListId: null, lists: LISTS })).toEqual({
      listId: "new",
      listName: "New Leads",
      leadType: "lead",
    });
  });

  it("a lead that is NOT archived is left alone", () => {
    expect(pickReviveTarget({ currentListId: "pre", formTargetListId: null, lists: LISTS })).toBeNull();
    expect(pickReviveTarget({ currentListId: "new", formTargetListId: null, lists: LISTS })).toBeNull();
  });

  it("a lead with no list is left alone", () => {
    expect(pickReviveTarget({ currentListId: null, formTargetListId: null, lists: LISTS })).toBeNull();
  });

  it("follows the form's routing list when it is a real list", () => {
    expect(pickReviveTarget({ currentListId: "arch", formTargetListId: "pre", lists: LISTS })?.listId).toBe("pre");
  });

  it("a form routed to Prospects makes the lead a prospect", () => {
    expect(pickReviveTarget({ currentListId: "arch", formTargetListId: "pros", lists: LISTS })?.leadType).toBe("prospect");
  });

  it("a form routed to an archive list is ignored — falls back to New", () => {
    expect(pickReviveTarget({ currentListId: "arch", formTargetListId: "arch", lists: LISTS })?.listId).toBe("new");
  });

  it("a form routing list that no longer exists falls back to New", () => {
    expect(pickReviveTarget({ currentListId: "arch", formTargetListId: "gone", lists: LISTS })?.listId).toBe("new");
  });

  it("no intake list and no routing list → nowhere to put it, so it stays", () => {
    expect(pickReviveTarget({ currentListId: "arch", formTargetListId: null, lists: [ARCHIVE, PRE] })).toBeNull();
  });
});
