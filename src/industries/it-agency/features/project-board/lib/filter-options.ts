import type { ProjectStatus, TaskStatus, TaskPriority } from "@/types/database";
import { type FilterOption } from "@/components/ui/filter-dropdown";

export const ALL_SENTINEL = "__all__";

export const STATUS_CHIPS: { value: ProjectStatus; label: string }[] = [
  { value: "planning",  label: "Discovery" },
  { value: "active",    label: "In Progress" },
  { value: "in_review", label: "Review" },
  { value: "delivered", label: "Delivered" },
  { value: "on_hold",   label: "On Hold" },
];

export const CANCELLED_CHIP: { value: ProjectStatus; label: string } = {
  value: "cancelled",
  label: "Cancelled",
};

export const TASK_STATUS_CHIPS: { value: TaskStatus; label: string }[] = [
  { value: "todo",        label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done",        label: "Done" },
];

export const PRIORITY_CHIPS: { value: TaskPriority; label: string; cls: string }[] = [
  { value: "low",    label: "Low",    cls: "bg-gray-100 text-gray-600 border-gray-200" },
  { value: "normal", label: "Normal", cls: "bg-blue-50 text-blue-600 border-blue-200" },
  { value: "high",   label: "High",   cls: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "urgent", label: "Urgent", cls: "bg-red-50 text-red-600 border-red-200" },
];

export const DUE_OPTIONS: FilterOption[] = [
  { value: ALL_SENTINEL, label: "All due dates" },
  { value: "overdue",    label: "Overdue" },
  { value: "today",      label: "Today" },
  { value: "this_week",  label: "This week" },
  { value: "none",       label: "No due date" },
];
