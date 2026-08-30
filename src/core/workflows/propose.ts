import type { WorkflowCommand } from './types.js';
import { ARTIFACT_RULES, CLI_NOTE, PLANNING_BOUNDARY } from './shared.js';

export function proposeCommand(): WorkflowCommand {
  return {
    id: 'propose',
    name: 'Spec Propose',
    description: 'Open a new change and write its proposal',
    argumentHint: '<what you want to build or fix>',
    body: `Open a new change and write the proposal that states why it exists.

${PLANNING_BOUNDARY}

${CLI_NOTE}

**Input**: a change name in kebab-case, or a description of what the user wants.

**Steps**

1. **Understand the request**

   If nothing usable was provided, ask - open-ended, no preset options:
   > "What change do you want to work on? Describe what you want to build or fix."

   Derive a kebab-case name from the description ("add user authentication" ->
   \`add-user-auth\`). Do not proceed without understanding what is being asked.

   If an ambiguity would materially change scope, observable behavior, compatibility
   or acceptance criteria, ask before creating the change. Record minor assumptions in
   the proposal instead of asking.

2. **Read the ground you are standing on**

   \`\`\`bash
   specs list --specs --json
   \`\`\`
   Existing capabilities tell you which specs this change would modify and which it
   would introduce. Read the specs that look related before writing the proposal.

3. **Create the change**

   \`\`\`bash
   specs new change "<name>" --json
   \`\`\`
   Add \`--schema "<schema>"\` only when the user asked for a specific workflow schema;
   \`specs schemas --json\` lists them. Add \`--skip-specs\` only when the change provably
   alters no observable behavior (refactor, tooling, docs) - never to dodge validation.

4. **Write the proposal**

${ARTIFACT_RULES.split('\n').map((line) => (line ? `   ${line}` : '')).join('\n')}

   The proposal's Capabilities section is the contract the spec deltas are written
   against, so name each capability precisely and use existing capability paths verbatim.

5. **Report**

   \`\`\`bash
   specs status --change "<name>"
   \`\`\`

**Output**

- the change name and where it lives;
- a two-line summary of the problem and the proposed scope;
- the capabilities the change will add or modify;
- next step: "Run \`/spec-plan\` when the proposal looks right."

**Guardrails**
- Stop after the proposal. The remaining artifacts belong to \`/spec-plan\`.
- Do not edit project code.
- If a change with that name exists, ask whether to continue it or pick another name.`,
  };
}
