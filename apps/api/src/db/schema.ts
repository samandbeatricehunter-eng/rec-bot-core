import { relations } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const recDiscordServers = pgTable("rec_discord_servers", {
  id: uuid("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  name: text("name"),
  setupStatus: text("setup_status"),
  setupMode: text("setup_mode"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
}, (table) => [
  uniqueIndex("rec_discord_servers_guild_id_key").on(table.guildId)
]);

export const recLeagues = pgTable("rec_leagues", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  leagueType: text("league_type"),
  displaySeasonNumber: integer("display_season_number"),
  currentPhase: text("current_phase"),
  currentWeek: integer("current_week"),
  fantasyDraftStatus: text("fantasy_draft_status"),
  trustMode: text("trust_mode"),
  importEnabled: boolean("import_enabled"),
  appAccountRequired: boolean("app_account_required"),
  seasonNumber: integer("season_number"),
  seasonStage: text("season_stage"),
  nextAdvanceAt: timestamp("next_advance_at", { withTimezone: true, mode: "string" }),
  nextAdvanceTimezone: text("next_advance_timezone"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
});

export const recServerLeagueLinks = pgTable("rec_server_league_links", {
  id: uuid("id").primaryKey(),
  serverId: uuid("server_id").notNull(),
  leagueId: uuid("league_id").notNull(),
  isPrimary: boolean("is_primary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
});

export const recImportJobs = pgTable("rec_import_jobs", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  serverId: uuid("server_id").notNull(),
  requestedByDiscordId: text("requested_by_discord_id"),
  importMode: text("import_mode").notNull(),
  importProfile: text("import_profile"),
  importScope: text("import_scope"),
  importLabel: text("import_label"),
  status: text("status").notNull(),
  weekFrom: integer("week_from"),
  weekTo: integer("week_to"),
  selectedWeeks: jsonb("selected_weeks").$type<number[] | null>(),
  selectedEndpointKeys: jsonb("selected_endpoint_keys").$type<string[] | null>(),
  eaExternalLeagueId: text("ea_external_league_id"),
  eaExternalLeagueName: text("ea_external_league_name"),
  previewSummary: jsonb("preview_summary").$type<Record<string, unknown> | null>(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  validationWarnings: jsonb("validation_warnings").$type<unknown[] | null>(),
  validationErrors: jsonb("validation_errors").$type<unknown[] | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" })
});

export const recSeasonSyncState = pgTable("rec_season_sync_state", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  seasonNumber: integer("season_number").notNull(),
  fullScheduleImportedAt: timestamp("full_schedule_imported_at", { withTimezone: true, mode: "string" }),
  fullScheduleImportJobId: uuid("full_schedule_import_job_id"),
  lastRosterSyncAt: timestamp("last_roster_sync_at", { withTimezone: true, mode: "string" }),
  lastRosterSyncImportJobId: uuid("last_roster_sync_import_job_id"),
  lastWeeklyImportWeek: integer("last_weekly_import_week"),
  lastWeeklyImportAt: timestamp("last_weekly_import_at", { withTimezone: true, mode: "string" }),
  lastWeeklyImportJobId: uuid("last_weekly_import_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
}, (table) => [
  uniqueIndex("rec_season_sync_state_league_season_key").on(table.leagueId, table.seasonNumber)
]);

export const recTeams = pgTable("rec_teams", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  name: text("name").notNull(),
  abbreviation: text("abbreviation"),
  conference: text("conference"),
  division: text("division"),
  maddenTeamId: text("madden_team_id"),
  displayCity: text("display_city"),
  displayNick: text("display_nick"),
  displayAbbr: text("display_abbr"),
  isRelocated: boolean("is_relocated"),
  source: text("source"),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
});

export const recGames = pgTable("rec_games", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  seasonNumber: integer("season_number"),
  weekNumber: integer("week_number"),
  phase: text("phase"),
  externalGameId: text("external_game_id"),
  homeTeamId: uuid("home_team_id"),
  awayTeamId: uuid("away_team_id"),
  homeUserId: uuid("home_user_id"),
  awayUserId: uuid("away_user_id"),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
});

export const recGameResults = pgTable("rec_game_results", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  gameId: uuid("game_id"),
  seasonNumber: integer("season_number"),
  weekNumber: integer("week_number"),
  phase: text("phase"),
  homeTeamId: uuid("home_team_id"),
  awayTeamId: uuid("away_team_id"),
  homeUserId: uuid("home_user_id"),
  awayUserId: uuid("away_user_id"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  winningUserId: uuid("winning_user_id"),
  resultSource: text("result_source"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
});

export const recWallets = pgTable("rec_wallets", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  walletBalance: integer("wallet_balance"),
  savingsBalance: integer("savings_balance"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
});

export const recDollarLedger = pgTable("rec_dollar_ledger", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  leagueId: uuid("league_id"),
  amount: integer("amount").notNull(),
  transactionType: text("transaction_type"),
  description: text("description"),
  source: text("source"),
  sourceReference: jsonb("source_reference").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
});

export const recCommissionersInbox = pgTable("rec_commissioners_inbox", {
  id: uuid("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  serverId: uuid("server_id").notNull(),
  leagueId: uuid("league_id").notNull(),
  itemType: text("item_type").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
});

export const recServerRelations = relations(recDiscordServers, ({ many }) => ({
  leagueLinks: many(recServerLeagueLinks)
}));

export const recLeagueRelations = relations(recLeagues, ({ many }) => ({
  serverLinks: many(recServerLeagueLinks),
  importJobs: many(recImportJobs),
  teams: many(recTeams),
  games: many(recGames),
  gameResults: many(recGameResults)
}));

export const recServerLeagueLinkRelations = relations(recServerLeagueLinks, ({ one }) => ({
  server: one(recDiscordServers, { fields: [recServerLeagueLinks.serverId], references: [recDiscordServers.id] }),
  league: one(recLeagues, { fields: [recServerLeagueLinks.leagueId], references: [recLeagues.id] })
}));

export type RecDiscordServer = typeof recDiscordServers.$inferSelect;
export type RecLeague = typeof recLeagues.$inferSelect;
export type RecServerLeagueLink = typeof recServerLeagueLinks.$inferSelect;
export type RecImportJob = typeof recImportJobs.$inferSelect;
export type RecSeasonSyncState = typeof recSeasonSyncState.$inferSelect;
