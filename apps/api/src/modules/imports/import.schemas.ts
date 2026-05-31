import { z } from "zod";

export const ImportModeSchema = z.enum(["manual", "ea_import", "companion_app_export"]);

export const CreateImportJobSchema = z.object({
  guildId: z.string().min(1),
  importMode: ImportModeSchema,
  importLabel: z.string().min(1).max(120).optional(),
  requestedByDiscordId: z.string().min(1).optional()
});

export const UpdateEndpointAttemptSchema = z.object({
  importJobId: z.string().uuid(),
  endpointKey: z.string().min(1).max(80),
  endpointLabel: z.string().min(1).max(120),
  status: z.enum(["pending", "running", "success", "failed", "skipped"]),
  httpStatus: z.number().int().optional().nullable(),
  attemptNumber: z.number().int().min(1).default(1),
  durationMs: z.number().int().min(0).optional().nullable(),
  recordsFound: z.number().int().min(0).optional().nullable(),
  errorMessage: z.string().optional().nullable(),
  responseSummary: z.record(z.any()).default({})
});

export const UpdateImportJobStatusSchema = z.object({
  importJobId: z.string().uuid(),
  status: z.enum([
    "created",
    "queued",
    "running",
    "validating",
    "reconciling",
    "completed",
    "completed_with_warnings",
    "failed",
    "cancelled"
  ]),
  previewSummary: z.record(z.any()).optional(),
  validationErrors: z.array(z.any()).optional(),
  validationWarnings: z.array(z.any()).optional(),
  failureReason: z.string().optional().nullable()
});

export type CreateImportJobInput = z.infer<typeof CreateImportJobSchema>;
export type UpdateEndpointAttemptInput = z.infer<typeof UpdateEndpointAttemptSchema>;
export type UpdateImportJobStatusInput = z.infer<typeof UpdateImportJobStatusSchema>;
