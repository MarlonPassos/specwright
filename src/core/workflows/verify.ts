import type { WorkflowCommand } from './types.js';
import { CLI_NOTE, RESOLVE_CHANGE } from './shared.js';

export function verifyCommand(): WorkflowCommand {
  return {
    id: 'verify',
    name: 'Spec Verify',
    description: 'Check an implemented change against its specs and tasks',
    argumentHint: '[change-name]',
    body: `Check an implemented change against what it promised.

${CLI_NOTE}

${RESOLVE_CHANGE}

**Steps**

1. **Run the structural checks**

   \`\`\`bash
   specs validate "<change>" --strict --json
   \`\`\`
   The report lists issues with a level (\`ERROR\`, \`WARNING\`, \`INFO\`), a location and a
   message. Under \`--strict\` a warning also fails the report.

2. **Check the checklist**

   \`\`\`bash
   specs status --change "<change>" --json
   \`\`\`
   Compare \`tasks.completed\` with \`tasks.total\`. For every ticked task, confirm the work
   it describes actually exists in the codebase. A ticked box with nothing behind it is a
   finding, not a formality.

3. **Check the behavior against the specs**

   \`\`\`bash
   specs show "<change>" --json --deltas-only
   \`\`\`
   For each requirement in the deltas, walk its scenarios and establish how each one is
   satisfied: a test that covers it, a command whose output shows it, or code you can point
   at. Run the project's test suite. Report a scenario you cannot tie to anything as
   unverified - do not assume.

4. **Check for drift**

   - behavior that was built but no spec describes -> the specs need an update;
   - requirements with no implementation -> the change is not done;
   - REMOVED requirements whose behavior is still present -> the removal is incomplete.

**Output**

A short report:
- validation result, with each error and warning;
- task completion, and any ticked task with nothing behind it;
- per capability: requirements verified, and how;
- unverified scenarios and drift, each with what would resolve it;
- a verdict: ready to archive, or the list of what to fix first;
- next step when ready: "Run \`/spec-archive\` to fold the specs in and close the change."

**Guardrails**
- Report what you find. Do not fix code silently while verifying - say what is wrong and
  let the user decide, unless they asked you to fix as you go.
- Never soften a requirement so the check passes.
- Do not archive from here; that is \`/spec-archive\`.`,
  };
}
