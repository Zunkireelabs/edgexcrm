import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { logger } from "@/lib/logger";

// Auto-flips class_enrollments.status to 'completed' once a class's end_date
// has passed. Only 'actual' + 'active' enrollments are touched — demo
// enrollments and already-inactive/completed rows are left alone.
export const classCompletionSweep = inngest.createFunction(
  { id: "class-completion-sweep", triggers: [{ cron: "0 18 * * *" }] },
  async () => {
    const supabase = await createServiceClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data: endedClasses, error: classError } = await supabase
      .from("classes")
      .select("id, tenant_id, name")
      .lt("end_date", today)
      .not("end_date", "is", null);

    if (classError) {
      logger.error({ err: classError }, "[class-completion-sweep] class query failed");
      return { completed: 0, error: classError.message };
    }

    type ClassRow = { id: string; tenant_id: string; name: string };
    const classes = (endedClasses ?? []) as unknown as ClassRow[];
    if (classes.length === 0) return { completed: 0 };

    let completed = 0;
    for (const cls of classes) {
      const { data: enrollments, error: enrollError } = await supabase
        .from("class_enrollments")
        .select("id")
        .eq("class_id", cls.id)
        .eq("enrollment_type", "actual")
        .eq("status", "active")
        .is("deleted_at", null);

      if (enrollError) {
        logger.error({ err: enrollError, classId: cls.id }, "[class-completion-sweep] enrollment query failed");
        continue;
      }

      const ids = ((enrollments ?? []) as unknown as { id: string }[]).map((e) => e.id);
      if (ids.length === 0) continue;

      const { error: updateError } = await supabase
        .from("class_enrollments")
        .update({ status: "completed" })
        .in("id", ids);

      if (updateError) {
        logger.error({ err: updateError, classId: cls.id }, "[class-completion-sweep] update failed");
        continue;
      }

      completed += ids.length;
      const requestId = crypto.randomUUID();
      await Promise.all(
        ids.flatMap((id) => [
          createAuditLog({
            tenantId: cls.tenant_id,
            userId: null,
            action: "class_enrollment.updated",
            entityType: "class_enrollment",
            entityId: id,
            changes: { patch: { old: { status: "active" }, new: { status: "completed" } } },
            requestId,
          }),
          emitEvent({
            tenantId: cls.tenant_id,
            type: "class_enrollment.updated",
            entityType: "class_enrollment",
            entityId: id,
            requestId,
          }),
        ])
      );

      logger.info({ classId: cls.id, className: cls.name, count: ids.length }, "[class-completion-sweep] marked completed");
    }

    return { completed };
  }
);
