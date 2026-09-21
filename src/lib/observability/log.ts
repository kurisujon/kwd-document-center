export type OperationalLog = {
  operation: string;
  outcome: "failure";
  category: string;
  status?: number;
  resourceId?: string;
};

/**
 * Emit only an allowlisted operational shape. Callers must pass categories and
 * identifiers, never provider errors, request headers, cookies, or user input.
 */
export function logOperationalFailure(event: OperationalLog): void {
  try {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
    }));
  } catch {
    // Operational logging is best-effort and must never replace the safe
    // application error that triggered it.
  }
}
