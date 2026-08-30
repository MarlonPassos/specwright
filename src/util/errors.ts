/**
 * An error carrying a machine-readable code and, when there is one, a command
 * the user can paste to recover. Every CLI failure path funnels through this so
 * text output and `--json` output describe the same failure.
 */
export class SpecError extends Error {
  readonly code: string;
  readonly fix?: string;

  constructor(message: string, options: { code?: string; fix?: string } = {}) {
    super(message);
    this.name = 'SpecError';
    this.code = options.code ?? 'error';
    this.fix = options.fix;
  }
}

export function errorCode(error: unknown): string {
  return error instanceof SpecError ? error.code : 'error';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorFix(error: unknown): string | undefined {
  return error instanceof SpecError ? error.fix : undefined;
}
