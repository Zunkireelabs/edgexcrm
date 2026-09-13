import { describe, it, expect } from "vitest";
import { splitTasksByProject } from "./split-tasks-by-project";

interface FakeTask {
  id: string;
  project_id: string | null;
}

describe("splitTasksByProject", () => {
  it("empty input: returns two empty arrays", () => {
    expect(splitTasksByProject<FakeTask>([])).toEqual({ projectTasks: [], personalTasks: [] });
  });

  it("all-project: everything lands in projectTasks", () => {
    const tasks: FakeTask[] = [
      { id: "1", project_id: "p1" },
      { id: "2", project_id: "p2" },
    ];
    expect(splitTasksByProject(tasks)).toEqual({ projectTasks: tasks, personalTasks: [] });
  });

  it("all-personal: everything lands in personalTasks", () => {
    const tasks: FakeTask[] = [
      { id: "1", project_id: null },
      { id: "2", project_id: null },
    ];
    expect(splitTasksByProject(tasks)).toEqual({ projectTasks: [], personalTasks: tasks });
  });

  it("mixed: splits into the two groups, order preserved within each", () => {
    const projectTaskA: FakeTask = { id: "1", project_id: "p1" };
    const personalTaskA: FakeTask = { id: "2", project_id: null };
    const projectTaskB: FakeTask = { id: "3", project_id: "p2" };
    const personalTaskB: FakeTask = { id: "4", project_id: null };

    const result = splitTasksByProject([projectTaskA, personalTaskA, projectTaskB, personalTaskB]);

    expect(result.projectTasks).toEqual([projectTaskA, projectTaskB]);
    expect(result.personalTasks).toEqual([personalTaskA, personalTaskB]);
  });
});
