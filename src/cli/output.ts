import { errorCode, errorFix, errorMessage } from '../util/errors.js';

export function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function printLines(lines: string[]): void {
  console.log(lines.join('\n'));
}

/**
 * Reports a failure and marks the process as failed.
 *
 * With `--json` the failure is the command's own null-shape plus an `error`
 * object, so stdout stays a single JSON document whichever way the command
 * ended. Without it the message goes to stderr with the recovery command, when
 * there is one.
 */
export function fail(
  error: unknown,
  options: { json?: boolean; payload?: Record<string, unknown> } = {}
): void {
  if (options.json) {
    printJson({
      ...(options.payload ?? {}),
      error: {
        code: errorCode(error),
        message: errorMessage(error),
        ...(errorFix(error) ? { fix: errorFix(error) } : {}),
      },
    });
  } else {
    console.error(`Erro: ${errorMessage(error)}`);
    const fix = errorFix(error);
    if (fix) console.error(`Correção: ${fix}`);
  }

  process.exitCode = 1;
}
