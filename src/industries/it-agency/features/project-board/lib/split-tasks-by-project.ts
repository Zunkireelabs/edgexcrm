interface TaskWithProjectId {
  project_id: string | null;
}

export interface SplitTasksResult<T> {
  projectTasks: T[];
  personalTasks: T[];
}

/**
 * Splits a task list into project-attached tasks and project-less
 * ("Personal") tasks, preserving the incoming order in each group so a
 * caller-applied sort stays stable within a group.
 */
export function splitTasksByProject<T extends TaskWithProjectId>(tasks: T[]): SplitTasksResult<T> {
  const projectTasks: T[] = [];
  const personalTasks: T[] = [];
  for (const task of tasks) {
    if (task.project_id) projectTasks.push(task);
    else personalTasks.push(task);
  }
  return { projectTasks, personalTasks };
}
