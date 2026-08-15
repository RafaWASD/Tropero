/** requestId de correlación: uuid v4 random, sin significado (no-PII). Spec 23. */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}
