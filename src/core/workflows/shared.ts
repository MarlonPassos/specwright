/** Fragments reused across workflow bodies so every command states them identically. */

export const CLI_NOTE = [
  'All commands below are the `specs` CLI. Run them from anywhere inside the project:',
  'the CLI finds the workspace by walking up from the working directory.',
  '',
  'Every command that prints JSON does so on stdout as a single document. Parse it -',
  'never guess a path, a status or an artifact id from the human-readable output.',
].join('\n');

export const RESOLVE_CHANGE = [
  '**Resolving the change**',
  '',
  'If the user named a change, use it. Otherwise run `specs list --json` and:',
  '- exactly one active change: use it, and say which one you picked;',
  '- several: ask the user which one;',
  '- none: say so and stop.',
].join('\n');

export const PLANNING_BOUNDARY = [
  '**Planning boundary**: this command produces planning artifacts only. The request',
  'that triggered it authorizes planning, even when it is phrased as "build" or "fix".',
  'Do not edit project code and do not start implementing. When the artifacts are done,',
  'stop and wait for a new request.',
].join('\n');

export const ARTIFACT_RULES = [
  '**Writing an artifact**',
  '',
  '1. Ask the CLI for its instructions:',
  '   ```bash',
  '   specs instructions <artifact-id> --change "<change>" --json',
  '   ```',
  '2. The response carries:',
  '   - `instruction` - the authoritative guidance for this artifact type;',
  '   - `template` - the structure to fill in;',
  '   - `context` and `rules` - constraints for YOU. Never copy them into the file;',
  '   - `outputPath` - where the artifact goes. When `outputIsPattern` is true, the path',
  '     is a pattern and `instruction` says how to choose the concrete file names;',
  '   - `dependencies` - artifacts to read first, with the files that hold them;',
  '   - `skipped` and `warning` - present when the change opted out of this artifact.',
  '     Do not create it; pick another one.',
  '3. Read every dependency file from disk before writing, even if you saw it earlier -',
  '   the user may have edited it since.',
  '4. Write the file at `outputPath` following `template` and `instruction`.',
  '5. Confirm the file exists before moving on.',
].join('\n');
