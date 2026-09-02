import { notFound } from "next/navigation";

// Hidden + unreachable. `roles-content.tsx` is still hardcoded mock data
// (MOCK_ROLES). This route will return as the AI-access-management surface
// once the real data model (positions + agents) exists — until then a direct
// URL must not reach fabricated data.
export default function OrcaRolesPage() {
  notFound();
}
