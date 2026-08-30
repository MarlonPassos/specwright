import path from 'node:path';
import { z } from 'zod';

/**
 * A path a schema author supplies. It must stay inside the directory the
 * runtime joins it to, so absolute paths, drive letters, `..` segments and NUL
 * bytes are all rejected up front.
 */
function containedPath(label: string) {
  return z
    .string()
    .min(1, `${label} is required`)
    .refine((value) => {
      if (value.includes('\0')) return false;
      if (/^[A-Za-z]:/.test(value)) return false;
      if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
      return !value.split(/[\\/]+/).includes('..');
    }, `${label} must be a relative path that stays inside its directory`);
}

export const ArtifactDefinitionSchema = z.object({
  id: z
    .string()
    .min(1, 'artifact id is required')
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'artifact id must be kebab-case'),
  generates: containedPath('generates'),
  description: z.string().default(''),
  template: containedPath('template'),
  instruction: z.string().optional(),
  requires: z.array(z.string()).default([]),
});

export const ApplyPhaseSchema = z.object({
  requires: z.array(z.string()).min(1, 'apply.requires needs at least one artifact id'),
  tracks: containedPath('apply.tracks').nullable().optional(),
  instruction: z.string().optional(),
});

export const WorkflowSchemaFileSchema = z.object({
  name: z.string().min(1, 'schema name is required'),
  version: z.number().int().positive('schema version must be a positive integer'),
  description: z.string().optional(),
  artifacts: z.array(ArtifactDefinitionSchema).min(1, 'a schema needs at least one artifact'),
  apply: ApplyPhaseSchema.optional(),
});

export type ArtifactDefinition = z.infer<typeof ArtifactDefinitionSchema>;
export type ApplyPhase = z.infer<typeof ApplyPhaseSchema>;
export type WorkflowSchemaFile = z.infer<typeof WorkflowSchemaFileSchema>;

/** Artifact ids whose output already exists on disk. */
export type CompletedArtifacts = ReadonlySet<string>;
