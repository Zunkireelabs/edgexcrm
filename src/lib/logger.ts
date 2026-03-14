import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: "lead-gen-crm" },
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino/file" },
  }),
});

export function createRequestLogger(meta: {
  requestId: string;
  method: string;
  path: string;
  ip?: string;
  tenantId?: string;
}) {
  return logger.child(meta);
}
