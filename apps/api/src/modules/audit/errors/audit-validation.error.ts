/**
 * Thrown when an audit event payload fails static or runtime validation invariants.
 */
export class AuditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an independent high-risk audit write fails to persist.
 */
export class AuditIndependentWriteError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AuditIndependentWriteError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
