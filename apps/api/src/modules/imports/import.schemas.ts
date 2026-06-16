import { z } from "zod";

export const ImportModeSchema = z.enum(["manual", "ea_import", "companion_app_export"]);

export const ImportScopeSchema = z.enum(["current_week", "single_week", "full_regular_season_schedule"]);

export const CoreImportEndpointSchema = z.enum([
  "league_metadata",
  "teams",
  "standings",
  "schedule",
  "rosters",
  "players",
  "player_stats",
  "team_stats",
  "transactions",
  "injuries"
]);

export const CreateImportJobSchema = z.object({
  guildId: z.string().min(1),
  importMode: ImportModeSchema,
  importLabel: z.string().min(1).max(120).optional(),
  requestedByDiscordId: z.string().min(1).optional(),
  eaExternalLeagueId: z.string().min(1).max(160).optional(),
  eaExternalLeagueName: z.string().min(1).max(160).optional(),
  importScope: ImportScopeSchema.default("current_week"),
  weekFrom: z.number().int().min(1).max(30).optional(),
  weekTo: z.number().int().min(1).max(30).optional(),
  selectedWeeks: z.array(z.number().int().min(1).max(30)).max(22).optional(),
  selectedEndpointKeys: z.array(CoreImportEndpointSchema).default([])
}).superRefine((input, context) => {
  if (input.importScope === "single_week" && !input.weekFrom && !input.selectedWeeks?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["weekFrom"], message: "Week imports require weekFrom or selectedWeeks." });
  }


  if (input.importScope === "full_regular_season_schedule" && input.selectedEndpointKeys.length > 0) {
    // Schedule imports may include Teams so EA team IDs can be resolved to league teams.
    const allowed = new Set(["schedule", "teams"]);
    const invalidEndpoints = input.selectedEndpointKeys.filter((endpoint) => !allowed.has(endpoint));
    if (invalidEndpoints.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedEndpointKeys"], message: "Full regular season schedule imports may only use the teams and schedule endpoints." });
    }
  }

  if (input.weekFrom && input.weekTo && input.weekFrom > input.weekTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["weekTo"], message: "weekTo must be greater than or equal to weekFrom." });
  }
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
