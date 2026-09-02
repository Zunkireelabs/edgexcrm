import { notFound } from "next/navigation";

// Hidden + unreachable. `compare-content.tsx` is still hardcoded mock data
// (MOCK_TASK_ROLES / MOCK_STATS / MOCK_HANDOFFS). Kept as the starting point
// for the real version — a direct URL must not reach fabricated data.
export default function OrcaComparePage() {
  notFound();
}
