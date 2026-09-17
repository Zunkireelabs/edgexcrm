"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RepeatableList } from "./repeatable-list";
import type { Lead } from "@/types/database";

// Matches the PDF's own "Test Scores" mockup: exam type picks which score
// fields are relevant. IELTS/PTE/TOEFL break scores out by skill; Duolingo
// and free-text "Other Tests" only ever report a single Overall number.
// SAT/GRE/GMAT aren't in the PDF's own list (that one's English-proficiency
// only) but the CRM's existing single-score columns already track them
// alongside IELTS/PTE/TOEFL under one "Test Report & Score" panel — kept
// here too so those existing scores have somewhere to auto-fill into.
const EXAM_TYPES = ["IELTS", "TOEFL", "PTE", "Duolingo English Test", "SAT", "GRE/GMAT", "Other Tests"] as const;
const SKILL_BREAKDOWN_EXAMS: readonly string[] = ["IELTS", "TOEFL", "PTE"];

export interface TestScore {
  id: string;
  examType: string;
  dateOfExam: string;
  listening: string;
  reading: string;
  writing: string;
  speaking: string;
  overall: string;
}

export function createTestScore(): TestScore {
  return {
    id: crypto.randomUUID(),
    examType: "",
    dateOfExam: "",
    listening: "",
    reading: "",
    writing: "",
    speaking: "",
    overall: "",
  };
}

const LEGACY_SCORE_COLUMNS: readonly { key: keyof Lead; examType: string }[] = [
  { key: "ielts_score", examType: "IELTS" },
  { key: "pte_score", examType: "PTE" },
  { key: "toefl_score", examType: "TOEFL" },
  { key: "sat_score", examType: "SAT" },
  { key: "gre_gmat_score", examType: "GRE/GMAT" },
];

/**
 * Auto-fills from the existing single-score columns on `leads` (same ones
 * the old Study Interest panel's "Test Report & Score" reads/writes). Each
 * non-empty column becomes one entry here with only Overall filled in —
 * those columns never captured a date or a skill breakdown, so there's
 * nothing to put in the other fields.
 */
export function testScoresFromLead(lead: Lead): TestScore[] {
  return LEGACY_SCORE_COLUMNS
    .map(({ key, examType }) => ({ key, examType, value: lead[key] }))
    .filter((entry): entry is { key: keyof Lead; examType: string; value: string } => typeof entry.value === "string" && entry.value.trim() !== "")
    .map(({ examType, value }) => ({ ...createTestScore(), examType, overall: value }));
}

export function TestScoresSection({
  isEditing,
  value,
  onChange,
}: {
  isEditing: boolean;
  value: TestScore[];
  onChange: (next: TestScore[]) => void;
}) {
  return (
    <RepeatableList
      items={value}
      isEditing={isEditing}
      onChange={onChange}
      createItem={createTestScore}
      addLabel="Add Test Score"
      emptyLabel="No test scores added yet."
      renderSummary={(item) => (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Exam Type</p>
            <p className="font-medium">{item.examType || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Date of Exam</p>
            <p className="font-medium">{item.dateOfExam || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Overall</p>
            <p className="font-medium">{item.overall || "—"}</p>
          </div>
          {SKILL_BREAKDOWN_EXAMS.includes(item.examType) && (
            <>
              <div>
                <p className="text-xs text-muted-foreground">Listening</p>
                <p className="font-medium">{item.listening || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reading</p>
                <p className="font-medium">{item.reading || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Writing</p>
                <p className="font-medium">{item.writing || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Speaking</p>
                <p className="font-medium">{item.speaking || "—"}</p>
              </div>
            </>
          )}
        </div>
      )}
      renderItem={(item, update) => {
        const showSkills = SKILL_BREAKDOWN_EXAMS.includes(item.examType);
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Exam Type</p>
              <Select value={item.examType || "__none__"} onValueChange={(v) => update({ examType: v === "__none__" ? "" : v })}>
                <SelectTrigger className="h-9 text-sm w-full">
                  <SelectValue placeholder="Select exam" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__"><span className="text-muted-foreground">Select exam</span></SelectItem>
                  {EXAM_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Date of Exam</p>
              <Input type="date" value={item.dateOfExam} onChange={(e) => update({ dateOfExam: e.target.value })} className="h-9 text-sm" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Overall</p>
              <Input value={item.overall} onChange={(e) => update({ overall: e.target.value })} placeholder="Overall score" className="h-9 text-sm" />
            </div>
            {showSkills && (
              <>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Listening</p>
                  <Input value={item.listening} onChange={(e) => update({ listening: e.target.value })} className="h-9 text-sm" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Reading</p>
                  <Input value={item.reading} onChange={(e) => update({ reading: e.target.value })} className="h-9 text-sm" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Writing</p>
                  <Input value={item.writing} onChange={(e) => update({ writing: e.target.value })} className="h-9 text-sm" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Speaking</p>
                  <Input value={item.speaking} onChange={(e) => update({ speaking: e.target.value })} className="h-9 text-sm" />
                </div>
              </>
            )}
          </div>
        );
      }}
    />
  );
}
