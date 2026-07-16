/** Concise, log-friendly error message instead of viem's multi-page nested dumps. */
export function errMsg(err: unknown): string {
  if (err && typeof err === "object") {
    const anyErr = err as { shortMessage?: string; message?: string };
    if (anyErr.shortMessage) return anyErr.shortMessage;
    if (anyErr.message) return anyErr.message;
  }
  return String(err);
}
