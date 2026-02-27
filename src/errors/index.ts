export class ApiError extends Error {
  public readonly status?: number;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, status?: number, context?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.context = context;
  }
}

export class DependencyError extends Error {
  public readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "DependencyError";
    this.context = context;
  }
}

export class ValidationError extends Error {
  public readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}
