import type { WorkflowCommand } from './types.js';
import { ARTIFACT_RULES, CLI_NOTE, PLANNING_BOUNDARY, RESOLVE_CHANGE } from './shared.js';

export function planCommand(): WorkflowCommand {
  return {
    id: 'plan',
    name: 'Spec Plan',
    description: 'Complete the planning artifacts of a change until it is ready to implement',
    argumentHint: '[change-name]',
    body: `Complete a change's planning artifacts until implementation can start.

${PLANNING_BOUNDARY}

${CLI_NOTE}

${RESOLVE_CHANGE}

**Steps**

1. **Read the current state**

   \`\`\`bash
   specs status --change "<change>" --json
   \`\`\`
   The response carries:
   - \`artifacts\` - every artifact with its \`state\` (\`done\`, \`ready\`, \`blocked\`,
     \`skipped\`), what it \`generates\`, the files that satisfy it, and its \`requires\` edges;
   - \`applyRequires\` - the artifacts implementation depends on, transitively;
   - \`applyBlockedBy\` - the ones still missing;
   - \`next\` - the artifacts that can be written right now;
   - \`workspace\` and \`changeRoot\` - resolved paths. Use them; do not assume any path.

2. **Write the missing artifacts**

   Track them with a todo list. Loop:

   a. Take an artifact from \`next\`.

${ARTIFACT_RULES.split('\n').map((line) => (line ? `      ${line}` : '')).join('\n')}

   b. Re-run \`specs status --change "<change>" --json\` after each artifact: finishing one
      unblocks others.

   c. Stop when \`applyBlockedBy\` is empty.

   Use \`applyRequires\`, not the states alone, to decide what is still owed: \`state\` only
   reports whether a file exists, so writing \`tasks.md\` early marks \`tasks\` done while its
   dependencies were never written.

   An artifact reading \`skipped\` is satisfied - the change opted out of it. Never create it.

   Skip an artifact only when its own \`instruction\` marks it conditional (the design
   document is the usual case). Say which one you skipped and why. A conditional artifact
   you skipped does not block its dependents: write those anyway.

3. **Validate before handing over**

   \`\`\`bash
   specs validate "<change>" --strict --json
   \`\`\`
   Fix what it reports and re-run until it passes. If a requirement is missing a scenario
   or a delta targets a requirement that does not exist, correct the artifact - never
   loosen the requirement to make the check pass.

**Output**

- artifacts written, one line each, plus any conditional artifact you skipped and why;
- the capabilities the deltas add or modify;
- validation result;
- next step: "Run \`/spec-implement\` when you are ready to build."

**Guardrails**
- Planning only. Do not edit project code and do not start implementing.
- Re-read dependency files from disk before writing an artifact that depends on them.
- Ask about ambiguities that would change scope, observable behavior or acceptance
  criteria; record minor assumptions in the artifacts.`,
  };
}
