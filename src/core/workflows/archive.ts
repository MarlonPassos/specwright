import type { WorkflowCommand } from './types.js';
import { CLI_NOTE, RESOLVE_CHANGE } from './shared.js';

export function archiveCommand(): WorkflowCommand {
  return {
    id: 'archive',
    name: 'Spec Archive',
    description: 'Fold a finished change into the workspace specs and archive it',
    argumentHint: '[change-name]',
    body: `Close out a finished change: fold its deltas into the workspace specs and archive it.

${CLI_NOTE}

${RESOLVE_CHANGE}

**Steps**

1. **Confirm the change is finished**

   \`\`\`bash
   specs status --change "<change>" --json
   specs validate "<change>" --strict --json
   \`\`\`
   Every task must be ticked and validation must pass. If either does not hold, stop and
   say what is outstanding. Unchecked tasks mean the work is not done - do not archive
   around them.

   If the change has not been verified yet, run \`/spec-verify\` first.

2. **Read what archiving will change**

   \`\`\`bash
   specs instructions archive --change "<change>" --json
   specs show "<change>" --json --deltas-only
   \`\`\`
   Each ADDED requirement is appended to its capability's spec, each MODIFIED replaces the
   existing block wholesale, each REMOVED deletes it, each RENAMED changes its header. A
   MODIFIED block carrying partial text loses the rest - check the deltas before running
   the archive, not after.

3. **Archive**

   \`\`\`bash
   specs archive "<change>" --json
   \`\`\`
   Add \`--skip-specs\` only for a change that declares no spec deltas. The command refuses
   to run while validation fails or tasks are unchecked; \`--force\` overrides the task check
   and is for exceptional cases the user has approved.

4. **Confirm the result**

   \`\`\`bash
   specs validate --specs --strict --json
   \`\`\`
   The merged specs must still be valid. If a newly created capability spec kept a
   placeholder purpose, replace it now by editing the workspace spec directly.

**Output**

- where the change was archived;
- capabilities created, updated and retired;
- anything left to do by hand, such as a placeholder purpose to replace.

**Guardrails**
- Archiving rewrites the workspace specs. Never run it on a change that is not implemented.
- Do not hand-edit a delta to make the merge succeed; fix the underlying mismatch.
- The archived change directory is a record. Do not edit it afterwards.`,
  };
}
