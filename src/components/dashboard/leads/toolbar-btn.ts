// Shared toolbar button styling for the Leads list toolbar (leads-table.tsx) and the
// Kanban toolbar (KanbanBoard.tsx) — kept in one place so the two toolbars can't drift
// out of sync again (they did: KanbanBoard's buttons used `rounded-md`, which this
// project's Tailwind theme remaps to 12px, while the list view used a fixed 8px).
export const TOOLBAR_BTN =
  "inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-[8px] border transition-colors border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]";

export const TOOLBAR_PRIMARY_BTN =
  "inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-[8px] transition-colors bg-[#0f0f10] text-white hover:bg-[#0f0f10]/90";

export const TOOLBAR_SEARCH_INPUT =
  "h-7 pl-7 pr-3 rounded-[8px] border border-gray-300 bg-white text-xs text-gray-600 placeholder:text-gray-400 outline-none focus:ring-1 focus:ring-ring";
