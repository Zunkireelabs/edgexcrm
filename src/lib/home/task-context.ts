/**
 * Precedence rule for the one task-context chip shared by every task row
 * renderer (Home Overview's TasksCard, the Tasks tab, and the shared
 * dashboard TaskRow used elsewhere): project beats deal beats lead beats
 * nothing. A `PersonalTask`/`TaskRowItem` carries all three relations
 * regardless of which one is actually set — at most one is ever non-null.
 *
 * The project branch is the only one that's conditionally a link: a chip
 * that points at `/projects/:id` on a tenant without the project board 404s,
 * which is worse than no chip — see docs/HOME-MY-WORK-BRIEF.md finding 6 /
 * the #500 lesson it restates. `href: null` tells the chip component to
 * render plain text instead of a link.
 */

export interface TaskContextSource {
  projects?: { id: string; name: string } | null;
  deals?: { id: string; name: string } | null;
  leads?: { id: string; first_name: string | null; last_name: string | null } | null;
}

export interface TaskContextResult {
  label: string;
  href: string | null;
}

export function deriveTaskContext(
  task: TaskContextSource,
  projectBoardEnabled: boolean,
): TaskContextResult | null {
  if (task.projects) {
    return {
      label: task.projects.name,
      href: projectBoardEnabled ? `/projects/${task.projects.id}` : null,
    };
  }

  if (task.deals) {
    return { label: task.deals.name, href: `/deals/${task.deals.id}` };
  }

  if (task.leads) {
    const name = [task.leads.first_name, task.leads.last_name].filter(Boolean).join(" ");
    if (!name) return null;
    return { label: name, href: `/leads/${task.leads.id}` };
  }

  return null;
}
