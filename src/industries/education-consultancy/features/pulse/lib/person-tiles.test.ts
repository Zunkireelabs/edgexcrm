import { describe, it, expect } from "vitest";
import { personTiles } from "./person-tiles";
import { normalizePosition } from "./positions";
import { ZERO_COUNTS, type PersonRow } from "./types";

const P = (slug: string, cur = {}, usual = {}): PersonRow => {
  const { key, label } = normalizePosition(slug);
  return { userId: "u", name: "N", email: null, positionSlug: slug, positionName: label, positionKey: key, positionLabel: label, branchId: null, branchName: null,
    current: { ...ZERO_COUNTS, ...cur }, previous: { ...ZERO_COUNTS }, usual: { ...ZERO_COUNTS, ...usual }, notesNew: 0, notesEdited: 0, movesByStage: {}, forwardByStage: {}, backByStage: {}, bulkMoves: 0, trend: [], flag: null };
};
const labels = (p: PersonRow) => personTiles(p, 3).map((t) => t.label);

describe("personTiles — role-aware", () => {
  it("TeleCaller: Calls / Notes / Moved / Untouched", () => expect(labels(P("telecaller"))).toEqual(["Calls", "Notes", "Moved", "Untouched"]));
  it("Counsellor: Calls / Notes / To Apps / Untouched, value from students reaching Applications", () => {
    expect(labels(P("counselor"))).toEqual(["Calls", "Notes", "To Apps", "Untouched"]);
    expect(personTiles(P("counsellor", { reached_applications: 9 }), 0)[2].value).toBe(9);
  });
  it("Executive: To Prospects; App Executive: Filed", () => {
    expect(labels(P("executive"))[2]).toBe("To Prospects");
    expect(labels(P("app-executive"))[2]).toBe("Filed");
  });
  it("no usual → null (the delta slot stays empty), never a placeholder", () => {
    const t = personTiles(P("counsellor", { reached_applications: 9 }), 4);
    expect(t[2].usual).toBeNull();
    expect(t[3]).toMatchObject({ value: 4, usual: null });
  });
});
