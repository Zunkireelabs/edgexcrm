"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ATTENDANCE_MIN_PEOPLE, ATTENDANCE_MIN_RECORDS, CAP_SLACK, DORMANT_DAYS, FIT_PRIOR, ROOM_FACTOR, WEIGHTS } from "../lib/assignment/weights";
import type { AssignmentMode } from "../lib/assignment/outcome";

interface Suggestion {
  window_days: number;
  positions: Array<{ slug: string; name: string; count: number }>;
  chosen: string[];
  total: number;
  covered: number;
}

const MODES: Array<{ value: AssignmentMode; label: string; hint: string }> = [
  { value: "off", label: "Off", hint: "New leads wait for a manager, as today." },
  { value: "shadow", label: "Shadow", hint: "It picks someone for every new lead but assigns nothing. Your home shows how often your managers agree." },
  { value: "auto", label: "Auto", hint: "It assigns each new lead the moment it arrives, tells the person, and shows you an FYI with Undo." },
];

/** Settings → Lead management (owner / admin): the mode, and a read-only explanation of how it picks. */
export function SmartAssignmentCard() {
  const [mode, setMode] = useState<AssignmentMode>("off");
  const [saved, setSaved] = useState<AssignmentMode>("off");
  const [positions, setPositions] = useState<string[]>([]);
  const [savedPositions, setSavedPositions] = useState<string[]>([]);
  const [positionsSaved, setPositionsSaved] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/v1/settings/lead-assignment")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { mode: AssignmentMode; first_touch_positions: string[]; positions_saved: boolean; suggestion: Suggestion | null } } | null) => {
        if (!live || !j?.data) return;
        setMode(j.data.mode);
        setSaved(j.data.mode);
        setPositions(j.data.first_touch_positions);
        setSavedPositions(j.data.first_touch_positions);
        setPositionsSaved(j.data.positions_saved);
        setSuggestion(j.data.suggestion);
        setLoaded(true);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const save = async () => {
    setBusy(true);
    const res = await fetch("/api/v1/settings/lead-assignment", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    setBusy(false);
    if (!res.ok) return toast.error("Couldn't save");
    setSaved(mode);
    toast.success(mode === "off" ? "Smart assignment is off" : `Smart assignment: ${mode}`);
  };

  const savePositions = async () => {
    setBusy(true);
    const res = await fetch("/api/v1/settings/lead-assignment", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: saved, first_touch_positions: positions }) });
    setBusy(false);
    if (!res.ok) return toast.error("Couldn't save");
    setSavedPositions(positions);
    setPositionsSaved(true);
    toast.success("First-touch positions saved");
  };
  const toggle = (slug: string) => setPositions((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]));
  const positionsDirty = !positionsSaved || positions.slice().sort().join() !== savedPositions.slice().sort().join();

  if (!loaded) return null;
  return (
    <div className="space-y-4" data-testid="smart-assignment-card">
      <div>
        <h3 className="text-sm font-medium text-gray-700">Smart assignment</h3>
        <p className="text-sm text-gray-500 mt-1">Picks who should take each new lead, with a reason you can read. Rules over your own data, no AI.</p>
      </div>
      <div role="radiogroup" aria-label="Smart assignment mode" className="space-y-2">
        {MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name="smart-assignment-mode" className="mt-1" checked={mode === m.value} onChange={() => setMode(m.value)} />
            <span><span className="font-medium text-gray-800">{m.label}</span><span className="block text-gray-500">{m.hint}</span></span>
          </label>
        ))}
      </div>
      <Button look="v2" variant="primary" size="sm" disabled={busy || mode === saved} onClick={save}>{busy ? "Saving" : "Save"}</Button>

      {suggestion && suggestion.positions.length > 0 ? (
        <div className="rounded-md border border-gray-200 p-3 text-sm space-y-2" data-testid="first-touch-positions">
          <p className="font-medium text-gray-700">Who takes new leads</p>
          <p className="text-gray-600">
            {positionsSaved ? "Your new leads went to " : "Suggested from your data: your new leads went to "}
            {suggestion.positions.map((p) => `${p.name} (${p.count})`).join(" and ")} in the last {suggestion.window_days} days.
            {positionsSaved ? "" : " Confirm or change who smart assignment may pick from."}
          </p>
          <div className="space-y-1">
            {suggestion.positions.map((p) => (
              <label key={p.slug} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={positions.includes(p.slug)} onChange={() => toggle(p.slug)} />
                <span>{p.name} <span className="text-gray-500">({p.count})</span></span>
              </label>
            ))}
          </div>
          <Button look="v2" variant="secondary" size="sm" disabled={busy || positions.length === 0 || !positionsDirty} onClick={savePositions}>
            {positionsSaved ? "Save positions" : "Use these"}
          </Button>
        </div>
      ) : null}

      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 space-y-1.5">
        <p className="font-medium text-gray-700">How it picks</p>
        <p>Who can get a lead: active people in {positions.length ? positions.join(", ") : "the first-touch positions"}, not on approved leave today, with some lead activity or note in the last {DORMANT_DAYS} days, in the lead&apos;s branch (only when that branch has someone in these positions), not flagged red or amber in Pulse&apos;s 7-day view, and under today&apos;s fair share plus {Math.round(CAP_SLACK * 100)}%. If nobody qualifies, nobody is picked: the lead stays unassigned and shows up in &ldquo;Assign new leads&rdquo; on your home.</p>
        <ul className="list-disc pl-5">
          <li><b>Fit ({WEIGHTS.fit})</b>: how often their leads (with the same destination, when the lead has one) reach Qualified, over the last 120 days, smoothed toward their overall rate (as if {FIT_PRIOR} more leads). Without a destination it uses their overall rate and says so.</li>
          <li><b>Room ({WEIGHTS.room})</b>: open leads against {ROOM_FACTOR}&times; the role&apos;s median.</li>
          <li><b>Speed ({WEIGHTS.speed})</b>: median minutes to first contact (a call, email, meeting or note) over the last 30 days. Full marks at 30 minutes or less, zero at a day.</li>
          <li><b>Present ({WEIGHTS.present})</b>: clocked in today, or any contact in the last 2 hours. Clock-in is only used once there are at least {ATTENDANCE_MIN_RECORDS} records from {ATTENDANCE_MIN_PEOPLE} people in 30 days.</li>
        </ul>
        <p>Ties go to whoever received the fewest leads today, then by name. Every pick is stored with each person&apos;s numbers, and the rates refresh every night.</p>
      </div>
    </div>
  );
}
