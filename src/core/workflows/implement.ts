import type { WorkflowCommand } from './types.js';
import { CLI_NOTE, RESOLVE_CHANGE } from './shared.js';

export function implementCommand(): WorkflowCommand {
  return {
    id: 'implement',
    name: 'Spec Implement',
    description: 'Implement a planned change, working through its task checklist',
    argumentHint: '[change-name]',
    body: `Implement a change that has been planned.

${CLI_NOTE}

${RESOLVE_CHANGE}

**Steps**

1. **Confirm the change is ready**

   \`\`\`bash
   specs status --change "<change>" --json
   \`\`\`
   If \`applyBlockedBy\` is not empty, stop and tell the user to run \`/spec-plan\` first.

2. **Load the phase instructions**

   \`\`\`bash
   specs instructions implement --change "<change>" --json
   \`\`\`
   The response carries the schema's implementation guidance, the file whose checkboxes
   track progress (\`tracks\`), the current task counts, and the resolved \`changeRoot\`.

3. **Read the plan**

   Read the change's artifacts from disk: the proposal for intent, the delta specs for
   the behavior contract, the design for the approach, the checklist for the order.
   The delta specs are the acceptance criteria - each scenario is a test worth having.

4. **Work the checklist**

   For each unchecked task, in order:
   - implement it;
   - run the verification the task names (a test, a command, an observable outcome);
   - only when it passes, tick its checkbox in the tracked file;
   - keep going.

   Do not tick a box for work that is not verified. Do not batch the ticks at the end -
   the checklist is the progress record, and a crash mid-run should not lose it.

5. **Stop and ask** when you hit a blocker, a decision the plan did not make, or work
   that would go beyond the change's stated scope. Widening the scope silently is worse
   than pausing.

6. **Report**

   \`\`\`bash
   specs status --change "<change>"
   \`\`\`

**Output**

- tasks completed this session, and what remains;
- deviations from the plan, with the reason;
- anything that surfaced and belongs in a separate change;
- next step: "Run \`/spec-verify\` to check the change against its specs."

**Guardrails**
- Build what the specs describe. If reality contradicts a spec, stop and update the spec
  with the user rather than building something the specs do not describe.
- If a task turns out to be wrong, fix the checklist as part of the work and say so.
- Never archive from here; that is \`/spec-archive\`.`,
  };
}
