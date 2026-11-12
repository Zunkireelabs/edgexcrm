"use client";

import { PlusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { dueLabel } from "./lib/labels";
import type { DateFmt } from "./lib/readiness";
import { ListBox, ListRow, Section } from "./parts";

export interface OverviewTask {
  id: string;
  title: string;
  due_date: string | null;
}

/**
 * Overview "Tasks" section. Always rendered once the preview has loaded (Attio): with 0 open tasks it is just the header,
 * the "0" chip and the "+", and NO box underneath; with tasks, up to 3 rows with an in-place complete checkbox.
 */
export function TasksSection({
  count, items, onAdd, onComplete, onOpen, dateFormat,
}: {
  count: number;
  items: OverviewTask[];
  onAdd: () => void;
  onComplete: (id: string) => void;
  onOpen: (id: string) => void;
  dateFormat?: DateFmt;
}) {
  return (
    <>
      <Section
        title="Tasks"
        count={count}
        right={<button type="button" aria-label="Add task" onClick={onAdd} className="flex hover:text-[#101112]"><PlusIcon className="size-[14px]" /></button>}
      />
      {items.length > 0 && (
        <ListBox>
          {items.slice(0, 3).map((t) => {
            const d = dueLabel(t.due_date, new Date(), dateFormat);
            return (
              <ListRow key={t.id}>
                <button type="button" aria-label={`Complete ${t.title}`} onClick={() => onComplete(t.id)} className="size-[14px] flex-none cursor-pointer rounded-[4px] shadow-[inset_0_0_0_1.5px_#d0d3d7] hover:shadow-[inset_0_0_0_1.5px_#12805c]" />
                <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 overflow-hidden text-ellipsis text-left">{t.title}</button>
                {d && <span className={cn("flex-none text-[12px]", d.overdue ? "text-[#b25e09]" : "text-black/50")}>{d.text}</span>}
              </ListRow>
            );
          })}
        </ListBox>
      )}
    </>
  );
}
