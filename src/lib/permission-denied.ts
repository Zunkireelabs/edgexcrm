/** Shown wherever a signed-in user is refused an action they are not allowed to do. */
export const PERMISSION_DENIED_MESSAGE =
  "You don't have permission for this. Please contact your admin.";

/**
 * Text for a failed API call: the standard "no permission" message when the server answered 403,
 * otherwise the screen's own fallback. Pass it to `toast.error`.
 */
export function failureMessage(res: Pick<Response, "status">, fallback: string): string {
  return res.status === 403 ? PERMISSION_DENIED_MESSAGE : fallback;
}
