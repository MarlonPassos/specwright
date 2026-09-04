import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { readFileIfExists, writeFileEnsured } from '../../util/fs.js';
import { CHANGE_METADATA_FILE } from '../workspace.js';

export const ChangeMetadataSchema = z.object({
  schema: z.string().min(1),
  created: z.string().optional(),
  goal: z.string().optional(),
  /**
   * Declares that the change alters no observable behavior, so it is allowed to
   * carry zero spec deltas. Validation rejects a zero-delta change without it.
   */
  skip_specs: z.boolean().optional(),
  /**
   * Opts this change into worktree-isolated parallel dispatch. Absent or
   * false keeps the change on the sequential, one-task-at-a-time path no
   * matter what the running harness supports - this is the single gate that
   * decides it, deliberately a change-level fact rather than something
   * inferred from tasks.md content, so an old change already on disk can
   * never slide into parallel mode on its own.
   */
  parallel: z.boolean().optional(),
});

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>;

export interface ChangeMetadataState {
  metadata?: ChangeMetadata;
  /** True when the file exists but does not parse as change metadata. */
  malformed: boolean;
  /** True when `skip_specs: true` is present in a file that parses. */
  skipSpecs: boolean;
  /** True when `parallel: true` is present in a file that parses. */
  parallel: boolean;
}

export function metadataPath(changeDir: string): string {
  return path.join(changeDir, CHANGE_METADATA_FILE);
}

export async function readChangeMetadata(changeDir: string): Promise<ChangeMetadataState> {
  const raw = await readFileIfExists(metadataPath(changeDir));
  if (raw === undefined) {
    return { malformed: false, skipSpecs: false, parallel: false };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return { malformed: true, skipSpecs: false, parallel: false };
  }

  const result = ChangeMetadataSchema.safeParse(parsed);
  if (!result.success) {
    return { malformed: true, skipSpecs: false, parallel: false };
  }

  return {
    metadata: result.data,
    malformed: false,
    skipSpecs: result.data.skip_specs === true,
    parallel: result.data.parallel === true,
  };
}

export async function writeChangeMetadata(
  changeDir: string,
  metadata: ChangeMetadata
): Promise<void> {
  const document: Record<string, unknown> = { schema: metadata.schema };
  if (metadata.created) document.created = metadata.created;
  if (metadata.goal) document.goal = metadata.goal;
  if (metadata.skip_specs !== undefined) document.skip_specs = metadata.skip_specs;
  if (metadata.parallel !== undefined) document.parallel = metadata.parallel;
  await writeFileEnsured(metadataPath(changeDir), stringifyYaml(document));
}
