"use client";

import "./home.css";
import { SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { BATCH_MAX, batchSummary, type BatchEntry } from "../lib/batch";

/** The card above Do next (H3b): "Orca can prepare N of these for you". Counts only messages the batch can really draft. */
export function PrepareAllCard({ entries, total, onPrepare }: { entries: BatchEntry[]; total: number; onPrepare: () => void }) {
  if (entries.length < 2) return null; // one message has its own Draft button on the row
  const n = entries.length;
  return (
    <div className="eh-prep" role="region" aria-label="Prepare all">
      <span className="spk"><SparkleIcon size={16} aria-hidden /></span>
      <div className="tx">
        <b>Orca can prepare {n} of these for you</b>
        <span>{batchSummary(entries)}. You check each one before anything is sent.{total > BATCH_MAX ? ` The first ${BATCH_MAX} now.` : ""}</span>
      </div>
      <Button look="v2" variant="secondary" size="sm" onClick={onPrepare}>Prepare all {n}</Button>
    </div>
  );
}
