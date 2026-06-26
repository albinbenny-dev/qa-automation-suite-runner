import { z } from 'zod';

// ── Helpers ────────────────────────────────────────────────────────────────

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid 6-digit hex color (e.g. #22d3ee)');

const slug = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens');

// ── Project ────────────────────────────────────────────────────────────────

export const CreateProjectSchema = z.object({
  name: z.string().min(2).max(100),
  slug: slug.optional(),
  description: z.string().max(500).optional(),
  baseUrl: z.string().max(500).optional().or(z.literal('')),
  color: z.string().min(1).max(200).optional().default('#22d3ee'),
  reqLibraryPath: z.string().max(500).optional(),
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  baseUrl: z.string().max(500).optional().or(z.literal('')),
  color: z.string().min(1).max(200).optional(),
  reqLibraryPath: z.string().max(500).optional().nullable(),
});

export const DeleteProjectSchema = z.object({
  confirmName: z.string().min(1, 'Project name confirmation is required'),
});

// ── Members ────────────────────────────────────────────────────────────────

export const CreateMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'SUPER_USER', 'STANDARD_USER']).default('SUPER_USER'),
});

export const UpdateMemberSchema = z.object({
  role: z.enum(['ADMIN', 'SUPER_USER', 'STANDARD_USER']),
});

// ── Environments ───────────────────────────────────────────────────────────

export const CreateEnvConfigSchema = z.object({
  name: z.string().min(1).max(50),
  baseUrl: z.string().url('Must be a valid URL'),
  username: z.string().max(200).optional(),
  password: z.string().max(200).optional(),
  isDefault: z.boolean().optional().default(false),
});

export const UpdateEnvConfigSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  baseUrl: z.string().url('Must be a valid URL').optional(),
  username: z.string().max(200).optional().nullable(),
  password: z.string().max(200).optional().nullable(),
  isDefault: z.boolean().optional(),
});

// ── Requirement Docs ───────────────────────────────────────────────────────

export const UploadReqDocSchema = z.object({
  // Optional override for the display filename
  displayName: z.string().max(200).optional(),
});

export const ToggleReqDocSchema = z.object({
  isActive: z.boolean(),
});

// ── Types ──────────────────────────────────────────────────────────────────

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type CreateMemberInput = z.infer<typeof CreateMemberSchema>;
export type CreateEnvConfigInput = z.infer<typeof CreateEnvConfigSchema>;
export type UpdateEnvConfigInput = z.infer<typeof UpdateEnvConfigSchema>;
