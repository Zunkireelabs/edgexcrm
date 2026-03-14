import { NextResponse } from "next/server";
import type { PaginationMeta } from "@/types/database";

// ── Rate Limit Header Injection ──────────────────────────────────

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number; // Unix epoch seconds
}

let _currentRateLimitInfo: RateLimitInfo | null = null;

/**
 * Set rate limit info for the current request cycle.
 * Called by gateIntegrationRequest after rate limit check.
 */
export function setRateLimitInfo(info: RateLimitInfo): void {
  _currentRateLimitInfo = info;
}

/**
 * Clear rate limit info after response is built.
 */
export function clearRateLimitInfo(): void {
  _currentRateLimitInfo = null;
}

function applyRateLimitHeaders(response: NextResponse): NextResponse {
  if (_currentRateLimitInfo) {
    response.headers.set("X-RateLimit-Limit", String(_currentRateLimitInfo.limit));
    response.headers.set("X-RateLimit-Remaining", String(_currentRateLimitInfo.remaining));
    response.headers.set("X-RateLimit-Reset", String(_currentRateLimitInfo.resetAt));
  }
  return response;
}

// ── Success Responses ────────────────────────────────────────────

export function apiSuccess(data: unknown, status = 200) {
  const response = NextResponse.json({ data }, { status });
  return applyRateLimitHeaders(response);
}

export function apiPaginated(data: unknown[], meta: PaginationMeta) {
  const response = NextResponse.json({ data, meta }, { status: 200 });
  return applyRateLimitHeaders(response);
}

// ── Error Responses ──────────────────────────────────────────────

export function apiError(
  code: string,
  message: string,
  status: number,
  details?: Record<string, string[]>
) {
  const response = NextResponse.json(
    { error: { code, message, ...(details && { details }) } },
    { status }
  );
  return applyRateLimitHeaders(response);
}

export function apiValidationError(details: Record<string, string[]>) {
  return apiError("VALIDATION_ERROR", "Validation failed", 422, details);
}

export function apiNotFound(entity = "Resource") {
  return apiError("NOT_FOUND", `${entity} not found`, 404);
}

export function apiUnauthorized() {
  return apiError("UNAUTHORIZED", "Authentication required", 401);
}

export function apiForbidden() {
  return apiError("FORBIDDEN", "Insufficient permissions", 403);
}

export function apiConflict(message: string) {
  return apiError("CONFLICT", message, 409);
}

export function apiRateLimited(retryAfterSeconds: number) {
  const response = new NextResponse(
    JSON.stringify({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
      },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
  if (_currentRateLimitInfo) {
    response.headers.set("X-RateLimit-Limit", String(_currentRateLimitInfo.limit));
    response.headers.set("X-RateLimit-Remaining", "0");
    response.headers.set("X-RateLimit-Reset", String(_currentRateLimitInfo.resetAt));
  }
  return response;
}

export function apiInternalError() {
  return apiError("INTERNAL_ERROR", "Unexpected server error", 500);
}

export function apiServiceUnavailable(message = "Service temporarily unavailable") {
  return apiError("SERVICE_UNAVAILABLE", message, 503);
}
