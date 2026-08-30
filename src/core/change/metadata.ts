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
});

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>;

export interface ChangeMetadataState {
  metadata?: ChangeMetadata;
  /** True when the file exists but does not parse as change metadata. */
  malformed: boolean;
  /** True when `skip_specs: true` is present in a file that parses. */
  skipSpecs: boolean;
}

export function metadataPath(changeDir: string): string {
  return path.join(changeDir, CHANGE_METADATA_FILE);
}

export async function readChangeMetadata(changeDir: string): Promise<ChangeMetadataState> {
  const raw = await readFileIfExists(metadataPath(changeDir));
  if (raw === undefined) {
    return { malformed: false, skipSpecs: false };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return { malformed: true, skipSpecs: false };
  }

  const result = ChangeMetadataSchema.safeParse(parsed);
  if (!result.success) {
    return { malformed: true, skipSpecs: false };
  }

  return {
    metadata: result.data,
    malformed: false,
    skipSpecs: result.data.skip_specs === true,
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
  await writeFileEnsured(metadataPath(changeDir), stringifyYaml(document));
}
