"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import type { ImportSourceReconciliationRow } from "@/types/database";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ReconciliationPanelProps {
  rows: ImportSourceReconciliationRow[];
}

function InCrmBreakdown({ row }: { row: ImportSourceReconciliationRow }) {
  const merged = Math.max(0, row.with_contact_rows + row.no_contact_rows - row.in_crm);
  return (
    <div className="space-y-0.5 text-left leading-relaxed">
      <div>You gave: {row.raw_rows.toLocaleString()}</div>
      {row.dropped_rows > 0 && (
        <div>− {row.dropped_rows.toLocaleString()} empty rows dropped (no name or contact)</div>
      )}
      {merged > 0 && (
        <div>− {merged.toLocaleString()} merged into existing / duplicate records</div>
      )}
      <div>= {row.in_crm.toLocaleString()} in CRM</div>
      {row.no_contact_rows > 0 && (
        <div className="text-gray-400 ml-3">
          ({row.no_contact_rows.toLocaleString()} name-only, no phone/email)
        </div>
      )}
    </div>
  );
}

export function ReconciliationPanel({ rows }: ReconciliationPanelProps) {
  const [open, setOpen] = useState(true);

  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (acc, r) => ({
      raw_rows: acc.raw_rows + r.raw_rows,
      in_crm: acc.in_crm + r.in_crm,
      routed_out: acc.routed_out + r.routed_out,
      still_in_staging: acc.still_in_staging + r.still_in_staging,
    }),
    { raw_rows: 0, in_crm: 0, routed_out: 0, still_in_staging: 0 },
  );

  return (
    <TooltipProvider>
      <div className="mb-4 border border-gray-200 rounded-lg bg-white overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Import Reconciliation
            <span className="text-xs font-normal text-gray-500">({rows.length} source files)</span>
          </span>
        </button>

        {open && (
          <div className="border-t border-gray-100">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-2 text-left font-medium">Source file</th>
                    <th className="px-4 py-2 text-right font-medium">You gave</th>
                    <th className="px-4 py-2 text-right font-medium">In CRM</th>
                    <th className="px-4 py-2 text-right font-medium">Routed</th>
                    <th className="px-4 py-2 text-right font-medium">Still here</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-400">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => {
                    const pct = r.raw_rows > 0 ? Math.round((r.in_crm / r.raw_rows) * 100) : 0;
                    const allRouted = r.still_in_staging === 0 && r.in_crm > 0;
                    return (
                      <tr key={r.source_label} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-800">{r.source_label}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {r.raw_rows.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center justify-end gap-1 cursor-default">
                                <span className={pct < 80 ? "text-amber-600" : "text-gray-700"}>
                                  {r.in_crm.toLocaleString()}
                                </span>
                                <span className="text-gray-400">({pct}%)</span>
                                <Info size={10} className="text-gray-400 shrink-0" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-[260px]">
                              <InCrmBreakdown row={r} />
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-green-700 font-medium">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center justify-end gap-1 cursor-default">
                                {r.routed_out > 0 ? (
                                  r.routed_out.toLocaleString()
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                                <Info size={10} className="text-gray-400 shrink-0" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              Moved out of staging into the live pipeline.
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center justify-end gap-1 cursor-default">
                                {allRouted ? (
                                  <span className="text-green-600 font-medium">Done</span>
                                ) : (
                                  <span className="text-gray-700">{r.still_in_staging.toLocaleString()}</span>
                                )}
                                <Info size={10} className="text-gray-400 shrink-0" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              Still in this staging list, awaiting routing. In CRM = Routed + Still here.
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-2 text-gray-400 italic">
                          {r.notes ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-700">
                    <td className="px-4 py-2">TOTAL</td>
                    <td className="px-4 py-2 text-right tabular-nums">{totals.raw_rows.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{totals.in_crm.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-green-700">{totals.routed_out.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{totals.still_in_staging.toLocaleString()}</td>
                    <td className="px-4 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
              Per-file totals sum to more than the staging count — a lead from two files is counted in both, matching your raw spreadsheets.
            </p>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
