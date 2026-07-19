import { z } from "zod";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { Logger } from "pino";
import type { IndustryId } from "@/industries/_registry";

export interface ToolContext {
  auth: AuthContext; // Phase 3 widens to AuthContext | AgentAuthContext
  db: ScopedClient; // ALWAYS scopedClient(auth) — never the service client
  logger: Logger; // request logger, child-scoped per tool call
  runId: string; // correlates audit rows + telemetry trace
  conversationId?: string; // ai_conversations.id, when known — recorded on ai_write_actions rows (mig 173)
  toolCallId?: string; // set only for scope:"write" tools (Phase 4C) — the SDK's per-call id, known at execute time unlike ai_write_actions.id
}

/** Boolean grant keys of ResolvedPermissions ("canManageHR", "canExport", ...). */
export type ToolPermissionKey = {
  [K in keyof ResolvedPermissions]: ResolvedPermissions[K] extends boolean ? K : never;
}[keyof ResolvedPermissions];

export interface AgentTool<In = unknown, Out = unknown> {
  id: string;
  description: string; // written for the model — concrete, with when-to-use
  inputSchema: z.ZodType<In>;
  scope: "read" | "write"; // "write" tools are excluded from buildToolset() unless AI_WRITE_TOOLS_ENABLED=true (Phase 4A)
  requiredPermission?: ToolPermissionKey; // boolean grant checked against auth.permissions before inclusion
  industries?: IndustryId[]; // undefined = universal
  execute(ctx: ToolContext, input: In): Promise<Out>;
}
