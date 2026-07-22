import { relations, sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// ============================================================================
// Core identity / league / server tables
// ============================================================================

export const recUsers = pgTable("rec_users", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  supabaseAuthUserId: uuid("supabase_auth_user_id"),
  username: text("username"),
  status: text("status").notNull().default("active"),
  subscriptionTier: text("subscription_tier").notNull().default("none"),
  billingStatus: text("billing_status").notNull().default("none"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionCurrentPeriodEnd: timestamp("subscription_current_period_end", { withTimezone: true, mode: "string" }),
  subscriptionGraceUntil: timestamp("subscription_grace_until", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
}, (table) => [
  check(
    "rec_users_username_format_check",
    sql`${table.username} is null or ${table.username} ~ '^[A-Za-z0-9_.]{3,24}$'`
  ),
  uniqueIndex("rec_users_supabase_auth_user_id_key")
    .on(table.supabaseAuthUserId)
    .where(sql`${table.supabaseAuthUserId} is not null`),
  uniqueIndex("rec_users_username_lower_key")
    .on(sql`lower(${table.username})`)
    .where(sql`${table.username} is not null`)
]);

export const recDiscordAccounts = pgTable("rec_discord_accounts", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  discordId: text("discord_id").notNull(),
  username: text("username"),
  globalName: text("global_name"),
  avatarUrl: text("avatar_url"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "string" }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recAppAccounts = pgTable("rec_app_accounts", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").references(() => recUsers.id),
  email: text("email"),
  displayName: text("display_name").notNull().default(""),
  appAccountRequired: boolean("app_account_required").notNull().default(false),
  activeEntitlement: boolean("active_entitlement").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recSiteIdentityClaims = pgTable("rec_site_identity_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: uuid("auth_user_id").notNull(),
  recUserId: uuid("rec_user_id").notNull().references(() => recUsers.id, { onDelete: "restrict" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("rec_site_identity_claims_auth_user_id_key").on(table.authUserId),
  uniqueIndex("rec_site_identity_claims_rec_user_id_key").on(table.recUserId)
]);

export const recSiteIdentityClaimChallenges = pgTable("rec_site_identity_claim_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: uuid("auth_user_id").notNull(),
  recUserId: uuid("rec_user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  discordAccountId: uuid("discord_account_id").notNull().references(() => recDiscordAccounts.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("rec_site_identity_claim_challenges_auth_user_id_key").on(table.authUserId),
  check(
    "rec_site_identity_claim_challenges_attempt_count_check",
    sql`${table.attemptCount} >= 0`
  ),
  index("rec_site_identity_claim_challenges_expires_idx").on(table.expiresAt),
  index("rec_site_identity_claim_challenges_rec_updated_idx")
    .on(table.recUserId, table.updatedAt.desc())
]);

export const recAppSettings = pgTable("rec_app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const recDiscordServers = pgTable("rec_discord_servers", {
  id: uuid("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull().default(""),
  setupStatus: text("setup_status").notNull().default("not_started"),
  setupMode: text("setup_mode").notNull().default("manual_first"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
}, (table) => [
  uniqueIndex("rec_discord_servers_guild_id_key").on(table.guildId)
]);

export const recLeagues = pgTable("rec_leagues", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  leagueType: text("league_type").notNull().default("madden_cfm"),
  displaySeasonNumber: integer("display_season_number"),
  currentPhase: text("current_phase").notNull().default("preseason"),
  currentWeek: integer("current_week"),
  fantasyDraftStatus: text("fantasy_draft_status").notNull().default("not_applicable"),
  trustMode: text("trust_mode").notNull().default("manual"),
  appAccountRequired: boolean("app_account_required").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  seasonNumber: integer("season_number").notNull().default(1),
  seasonStage: text("season_stage").notNull().default("regular_season"),
  nextAdvanceAt: timestamp("next_advance_at", { withTimezone: true, mode: "string" }),
  nextAdvanceTimezone: text("next_advance_timezone"),
  interestDisabledUntil: timestamp("interest_disabled_until", { withTimezone: true, mode: "string" }),
  advanceRateWindowStart: timestamp("advance_rate_window_start", { withTimezone: true, mode: "string" }),
  advanceRateCount: integer("advance_rate_count").notNull().default(0),
  lastAdvancedAt: timestamp("last_advanced_at", { withTimezone: true, mode: "string" }),
  game: text("game").notNull().default("madden_26"),
  ownerUserId: uuid("owner_user_id").references(() => recUsers.id),
  discordBotEnabled: boolean("discord_bot_enabled").notNull().default(false),
  discordBotInviteToken: text("discord_bot_invite_token"),
  discordBotInviteCreatedAt: timestamp("discord_bot_invite_created_at", { withTimezone: true, mode: "string" }),
  subscriptionFrozen: boolean("subscription_frozen").notNull().default(false),
  subscriptionFrozenAt: timestamp("subscription_frozen_at", { withTimezone: true, mode: "string" }),
  subscriptionFreezeReason: text("subscription_freeze_reason")
});

export const recServerLeagueLinks = pgTable("rec_server_league_links", {
  id: uuid("id").primaryKey(),
  serverId: uuid("server_id").notNull().references(() => recDiscordServers.id),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  isPrimary: boolean("is_primary").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recSiteFriendships = pgTable("rec_site_friendships", {
  id: uuid("id").primaryKey().defaultRandom(),
  requesterUserId: uuid("requester_user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  addresseeUserId: uuid("addressee_user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true, mode: "string" })
}, (table) => [
  check(
    "rec_site_friendships_status_check",
    sql`${table.status} in ('pending', 'accepted', 'declined')`
  ),
  check(
    "rec_site_friendships_not_self_check",
    sql`${table.requesterUserId} <> ${table.addresseeUserId}`
  ),
  uniqueIndex("rec_site_friendships_pair_uidx").on(
    sql`least(${table.requesterUserId}, ${table.addresseeUserId})`,
    sql`greatest(${table.requesterUserId}, ${table.addresseeUserId})`
  ),
  index("rec_site_friendships_requester_idx").on(table.requesterUserId, table.status),
  index("rec_site_friendships_addressee_idx").on(table.addresseeUserId, table.status)
]);

export const recSiteConversations = pgTable("rec_site_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  leagueId: uuid("league_id").references(() => recLeagues.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  dmUserLowId: uuid("dm_user_low_id").references(() => recUsers.id, { onDelete: "cascade" }),
  dmUserHighId: uuid("dm_user_high_id").references(() => recUsers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "string" })
}, (table) => [
  check(
    "rec_site_conversations_kind_check",
    sql`${table.kind} in ('dm', 'commissioner', 'support')`
  ),
  uniqueIndex("rec_site_conversations_dm_pair_uidx")
    .on(table.dmUserLowId, table.dmUserHighId)
    .where(sql`${table.kind} = 'dm'`),
  uniqueIndex("rec_site_conversations_commissioner_uidx")
    .on(table.leagueId, table.createdByUserId)
    .where(sql`${table.kind} = 'commissioner'`),
  index("rec_site_conversations_last_message_at_idx").on(table.lastMessageAt.desc())
]);

export const recSiteConversationMembers = pgTable("rec_site_conversation_members", {
  conversationId: uuid("conversation_id").notNull().references(() => recSiteConversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true, mode: "string" }),
  hiddenAt: timestamp("hidden_at", { withTimezone: true, mode: "string" })
}, (table) => [
  uniqueIndex("rec_site_conversation_members_pair_uidx").on(table.conversationId, table.userId),
  check(
    "rec_site_conversation_members_role_check",
    sql`${table.role} in ('member', 'commissioner', 'support_agent')`
  ),
  index("rec_site_conversation_members_user_idx").on(table.userId)
]);

export const recSiteMessages = pgTable("rec_site_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => recSiteConversations.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  reportedAt: timestamp("reported_at", { withTimezone: true, mode: "string" })
}, (table) => [
  check(
    "rec_site_messages_body_length_check",
    sql`char_length(${table.body}) between 1 and 4000`
  ),
  index("rec_site_messages_conversation_created_idx").on(table.conversationId, table.createdAt)
]);

export const recSiteNotifications = pgTable("rec_site_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  leagueId: uuid("league_id").references(() => recLeagues.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  href: text("href").notNull(),
  readAt: timestamp("read_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow()
}, (table) => [
  index("rec_site_notifications_user_created_idx").on(table.userId, table.createdAt.desc()),
  index("rec_site_notifications_user_unread_idx")
    .on(table.userId)
    .where(sql`${table.readAt} is null`)
]);

export const recSeasons = pgTable("rec_seasons", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  displaySeasonNumber: integer("display_season_number"),
  phase: text("phase").notNull().default("preseason"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recMaddenSourceLinks = pgTable("rec_madden_source_links", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  sourceName: text("source_name").notNull().default("madden"),
  maddenLeagueId: text("madden_league_id"),
  maddenSeasonKey: text("madden_season_key"),
  platform: text("platform"),
  connectedByUserId: uuid("connected_by_user_id").references(() => recUsers.id),
  connectedAt: timestamp("connected_at", { withTimezone: true, mode: "string" }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recServerRoutes = pgTable("rec_server_routes", {
  id: uuid("id").primaryKey(),
  serverId: uuid("server_id").notNull().references(() => recDiscordServers.id),
  generalChatChannelId: text("general_chat_channel_id"),
  schedulingChannelId: text("scheduling_channel_id"),
  mediaChannelId: text("media_channel_id"),
  rulesChannelId: text("rules_channel_id"),
  announcementsChannelId: text("announcements_channel_id"),
  economyChannelId: text("economy_channel_id"),
  schedulingChannelIsRefreshable: boolean("scheduling_channel_is_refreshable").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  pendingEconomyChannelId: text("pending_economy_channel_id"),
  gameChannelsCategoryId: text("game_channels_category_id"),
  gameOfWeekChannelId: text("game_of_week_channel_id"),
  streamsChannelId: text("streams_channel_id"),
  highlightsChannelId: text("highlights_channel_id"),
  commissionerRoleId: text("commissioner_role_id"),
  compCommitteeRoleId: text("comp_committee_role_id"),
  boxScoresChannelId: text("box_scores_channel_id"),
  weeklySubmissionsChannelId: text("weekly_submissions_channel_id"),
  recGuideChannelId: text("rec_guide_channel_id"),
  weeklySubmissionsPanelMessageId: text("weekly_submissions_panel_message_id"),
  powerRankingsChannelId: text("power_rankings_channel_id")
});

export const recServerAdminRoles = pgTable("rec_server_admin_roles", {
  id: uuid("id").primaryKey(),
  serverId: uuid("server_id").notNull().references(() => recDiscordServers.id),
  roleId: text("role_id").notNull(),
  roleName: text("role_name"),
  roleType: text("role_type").notNull().default("admin"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recTeams = pgTable("rec_teams", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  name: text("name").notNull(),
  abbreviation: text("abbreviation"),
  conference: text("conference"),
  division: text("division"),
  maddenTeamId: text("madden_team_id"),
  source: text("source").notNull().default("manual_admin_entry"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  displayCity: text("display_city"),
  displayNick: text("display_nick"),
  displayAbbr: text("display_abbr"),
  isRelocated: boolean("is_relocated").notNull().default(false),
  originalAbbreviation: text("original_abbreviation"),
  isSchedulePlaceholder: boolean("is_schedule_placeholder").notNull().default(false)
  ,primaryColor: text("primary_color").notNull().default("#FFFFFF")
});

export const recLeagueMemberships = pgTable("rec_league_memberships", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  status: text("status").notNull().default("active"),
  role: text("role").notNull().default("member"),
  appAccessRequired: boolean("app_access_required").notNull().default(false),
  appAccessVerified: boolean("app_access_verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recTeamAssignments = pgTable("rec_team_assignments", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  teamId: uuid("team_id").notNull().references(() => recTeams.id),
  userId: uuid("user_id").references(() => recUsers.id),
  assignmentStatus: text("assignment_status").notNull().default("manual_pending_import_validation"),
  source: text("source").notNull().default("manual_admin_entry"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
  notes: text("notes"),
  discordJoinedAt: timestamp("discord_joined_at", { withTimezone: true, mode: "string" }),
  statsCreditStartsAt: timestamp("stats_credit_starts_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recAccountReconciliationQueue = pgTable("rec_account_reconciliation_queue", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  importedEaPersonaName: text("imported_ea_persona_name"),
  importedGamertag: text("imported_gamertag"),
  importedBlazeId: text("imported_blaze_id"),
  importedPlatform: text("imported_platform"),
  possibleUserId: uuid("possible_user_id").references(() => recUsers.id),
  status: text("status").notNull().default("unresolved"),
  issueType: text("issue_type").notNull().default("needs_review"),
  adminNotes: text("admin_notes"),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => recUsers.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

// ============================================================================
// Records (global / league / season)
// ============================================================================

export const recGlobalUserRecords = pgTable("rec_global_user_records", {
  userId: uuid("user_id").primaryKey().references(() => recUsers.id),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  ties: integer("ties").notNull().default(0),
  playoffWins: integer("playoff_wins").notNull().default(0),
  playoffLosses: integer("playoff_losses").notNull().default(0),
  superbowlWins: integer("superbowl_wins").notNull().default(0),
  superbowlLosses: integer("superbowl_losses").notNull().default(0),
  pointDifferential: integer("point_differential").notNull().default(0),
  closeGamesWithin7: integer("close_games_within_7").notNull().default(0),
  blowoutWinsBy22Plus: integer("blowout_wins_by_22_plus").notNull().default(0),
  blowoutLossesBy22Plus: integer("blowout_losses_by_22_plus").notNull().default(0),
  legacyLocked: boolean("legacy_locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  pointsFor: integer("points_for").notNull().default(0),
  pointsAgainst: integer("points_against").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  avgPointDifferential: numeric("avg_point_differential").notNull().default("0")
});

export const recLeagueUserRecords = pgTable("rec_league_user_records", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  ties: integer("ties").notNull().default(0),
  playoffWins: integer("playoff_wins").notNull().default(0),
  playoffLosses: integer("playoff_losses").notNull().default(0),
  superbowlWins: integer("superbowl_wins").notNull().default(0),
  superbowlLosses: integer("superbowl_losses").notNull().default(0),
  pointDifferential: integer("point_differential").notNull().default(0),
  closeGamesWithin7: integer("close_games_within_7").notNull().default(0),
  blowoutWinsBy22Plus: integer("blowout_wins_by_22_plus").notNull().default(0),
  blowoutLossesBy22Plus: integer("blowout_losses_by_22_plus").notNull().default(0),
  legacyLocked: boolean("legacy_locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  pointsFor: integer("points_for").notNull().default(0),
  pointsAgainst: integer("points_against").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  avgPointDifferential: numeric("avg_point_differential").notNull().default("0")
});

export const recSeasonUserRecords = pgTable("rec_season_user_records", {
  id: uuid("id").primaryKey(),
  seasonId: uuid("season_id").references(() => recSeasons.id),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  ties: integer("ties").notNull().default(0),
  playoffWins: integer("playoff_wins").notNull().default(0),
  playoffLosses: integer("playoff_losses").notNull().default(0),
  superbowlWins: integer("superbowl_wins").notNull().default(0),
  superbowlLosses: integer("superbowl_losses").notNull().default(0),
  pointDifferential: integer("point_differential").notNull().default(0),
  closeGamesWithin7: integer("close_games_within_7").notNull().default(0),
  blowoutWinsBy22Plus: integer("blowout_wins_by_22_plus").notNull().default(0),
  blowoutLossesBy22Plus: integer("blowout_losses_by_22_plus").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  seasonNumber: integer("season_number"),
  avgPointDifferential: numeric("avg_point_differential").default("0"),
  gamesPlayed: integer("games_played").default(0),
  pointsFor: integer("points_for").notNull().default(0),
  pointsAgainst: integer("points_against").notNull().default(0)
});

export const recLegacyUserBaselines = pgTable("rec_legacy_user_baselines", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").references(() => recUsers.id),
  sourceBot: text("source_bot").notNull().default("legacy_bot"),
  sourceServerId: text("source_server_id"),
  sourceReference: jsonb("source_reference").$type<Record<string, unknown> | null>(),
  migratedByUserId: uuid("migrated_by_user_id").references(() => recUsers.id),
  migratedAt: timestamp("migrated_at", { withTimezone: true, mode: "string" }).notNull(),
  walletBalanceStart: integer("wallet_balance_start").notNull().default(0),
  savingsBalanceStart: integer("savings_balance_start").notNull().default(0),
  globalRecord: jsonb("global_record").$type<Record<string, unknown> | null>(),
  leagueRecords: jsonb("league_records").$type<Record<string, unknown> | null>(),
  pendingPurchaseCount: integer("pending_purchase_count").notNull().default(0),
  unresolvedNotes: text("unresolved_notes"),
  locked: boolean("locked").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

// ============================================================================
// Economy
// ============================================================================

export const recWallets = pgTable("rec_wallets", {
  userId: uuid("user_id").primaryKey().references(() => recUsers.id),
  walletBalance: integer("wallet_balance").notNull().default(0),
  savingsBalance: integer("savings_balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recDollarLedger = pgTable("rec_dollar_ledger", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  leagueId: uuid("league_id").references(() => recLeagues.id),
  seasonId: uuid("season_id").references(() => recSeasons.id),
  amount: integer("amount").notNull(),
  transactionType: text("transaction_type").notNull(),
  description: text("description"),
  source: text("source").notNull().default("manual_admin_entry"),
  sourceReference: jsonb("source_reference").$type<Record<string, unknown> | null>(),
  createdByUserId: uuid("created_by_user_id").references(() => recUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recPurchases = pgTable("rec_purchases", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  leagueId: uuid("league_id").references(() => recLeagues.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  purchaseType: text("purchase_type").notNull(),
  status: text("status").notNull().default("pending"),
  cost: integer("cost").notNull().default(0),
  alreadyDeducted: boolean("already_deducted").notNull().default(true),
  details: jsonb("details").$type<Record<string, unknown> | null>(),
  adminNotes: text("admin_notes"),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  seasonId: uuid("season_id").references(() => recSeasons.id),
  seasonNumber: integer("season_number"),
  discordId: text("discord_id"),
  debitLedgerId: uuid("debit_ledger_id"),
  refundLedgerId: uuid("refund_ledger_id"),
  discordMessageId: text("discord_message_id"),
  discordChannelId: text("discord_channel_id"),
  reviewedByDiscordId: text("reviewed_by_discord_id"),
  deniedReason: text("denied_reason")
});

export const recPurchaseHolds = pgTable("rec_purchase_holds", {
  id: uuid("id").primaryKey(),
  purchaseId: uuid("purchase_id").notNull().references(() => recPurchases.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("held"),
  heldAt: timestamp("held_at", { withTimezone: true, mode: "string" }).notNull(),
  clearedAt: timestamp("cleared_at", { withTimezone: true, mode: "string" }),
  refundedAt: timestamp("refunded_at", { withTimezone: true, mode: "string" }),
  refundReason: text("refund_reason"),
  createdByUserId: uuid("created_by_user_id").references(() => recUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export type RecUser = typeof recUsers.$inferSelect;
export type RecDiscordAccount = typeof recDiscordAccounts.$inferSelect;
export type RecAppAccount = typeof recAppAccounts.$inferSelect;
export type RecDiscordServer = typeof recDiscordServers.$inferSelect;
export type RecLeague = typeof recLeagues.$inferSelect;
export type RecServerLeagueLink = typeof recServerLeagueLinks.$inferSelect;
export type RecSeason = typeof recSeasons.$inferSelect;
export type RecMaddenSourceLink = typeof recMaddenSourceLinks.$inferSelect;
export type RecServerRoute = typeof recServerRoutes.$inferSelect;
export type RecServerAdminRole = typeof recServerAdminRoles.$inferSelect;
export type RecTeam = typeof recTeams.$inferSelect;
export type RecLeagueMembership = typeof recLeagueMemberships.$inferSelect;
export type RecTeamAssignment = typeof recTeamAssignments.$inferSelect;
export type RecAccountReconciliationQueue = typeof recAccountReconciliationQueue.$inferSelect;
export type RecGlobalUserRecord = typeof recGlobalUserRecords.$inferSelect;
export type RecLeagueUserRecord = typeof recLeagueUserRecords.$inferSelect;
export type RecSeasonUserRecord = typeof recSeasonUserRecords.$inferSelect;
export type RecLegacyUserBaseline = typeof recLegacyUserBaselines.$inferSelect;
export type RecWallet = typeof recWallets.$inferSelect;
export type RecDollarLedger = typeof recDollarLedger.$inferSelect;
export type RecPurchase = typeof recPurchases.$inferSelect;
export type RecPurchaseHold = typeof recPurchaseHolds.$inferSelect;

// ============================================================================
// Games / schedule / draft
// ============================================================================

export const recGames = pgTable("rec_games", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonId: uuid("season_id").references(() => recSeasons.id),
  weekNumber: integer("week_number"),
  phase: text("phase").notNull().default("regular_season"),
  homeTeamId: uuid("home_team_id").references(() => recTeams.id),
  awayTeamId: uuid("away_team_id").references(() => recTeams.id),
  homeUserId: uuid("home_user_id").references(() => recUsers.id),
  awayUserId: uuid("away_user_id").references(() => recUsers.id),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  status: text("status").notNull().default("scheduled"),
  source: text("source").notNull().default("manual_admin_entry"),
  importVerified: boolean("import_verified").notNull().default(false),
  manualEntered: boolean("manual_entered").notNull().default(true),
  resultPayoutEligible: boolean("result_payout_eligible").notNull().default(false),
  eosPayoutEligible: boolean("eos_payout_eligible").notNull().default(false),
  externalGameId: text("external_game_id"),
  locked: boolean("locked").notNull().default(false),
  lockedReason: text("locked_reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  advanceOutcomeOverride: text("advance_outcome_override"),
  advanceOutcomeMarkedByDiscordId: text("advance_outcome_marked_by_discord_id"),
  advanceOutcomeMarkedAt: timestamp("advance_outcome_marked_at", { withTimezone: true, mode: "string" }),
  isBowlGame: boolean("is_bowl_game").notNull().default(false),
  isNationalChampionship: boolean("is_national_championship").notNull().default(false)
  ,rivalryId: uuid("rivalry_id")
  ,rivalryOptOut: boolean("rivalry_opt_out").notNull().default(false)
});

export const recGameResults = pgTable("rec_game_results", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number"),
  weekNumber: integer("week_number"),
  gameType: text("game_type").notNull().default("regular_season"),
  externalGameId: text("external_game_id"),
  homeTeamId: uuid("home_team_id").references(() => recTeams.id),
  awayTeamId: uuid("away_team_id").references(() => recTeams.id),
  homeUserId: uuid("home_user_id").references(() => recUsers.id),
  awayUserId: uuid("away_user_id").references(() => recUsers.id),
  homeScore: integer("home_score").notNull().default(0),
  awayScore: integer("away_score").notNull().default(0),
  winningUserId: uuid("winning_user_id").references(() => recUsers.id),
  losingUserId: uuid("losing_user_id").references(() => recUsers.id),
  winningTeamId: uuid("winning_team_id").references(() => recTeams.id),
  losingTeamId: uuid("losing_team_id").references(() => recTeams.id),
  isUserH2h: boolean("is_user_h2h").notNull().default(false),
  isPlayoff: boolean("is_playoff").notNull().default(false),
  isSuperBowl: boolean("is_super_bowl").notNull().default(false),
  isCpuGame: boolean("is_cpu_game").notNull().default(false),
  isTie: boolean("is_tie").notNull().default(false),
  pointDifferential: integer("point_differential"),
  playedAt: timestamp("played_at", { withTimezone: true, mode: "string" }),
  source: text("source").notNull().default("manual"),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
  manualStats: jsonb("manual_stats").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  recordsAppliedAt: timestamp("records_applied_at", { withTimezone: true, mode: "string" }),
  recordsApplyKey: text("records_apply_key")
});

export const recTeamByes = pgTable("rec_team_byes", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  teamId: uuid("team_id").notNull().references(() => recTeams.id),
  weekNumber: integer("week_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recGameSchedulingEvents = pgTable("rec_game_scheduling_events", {
  id: uuid("id").primaryKey(),
  gameId: uuid("game_id").notNull().references(() => recGames.id),
  userId: uuid("user_id").references(() => recUsers.id),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recDraftPicks = pgTable("rec_draft_picks", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonId: uuid("season_id").references(() => recSeasons.id),
  seasonOffset: integer("season_offset").notNull().default(0),
  roundNumber: integer("round_number").notNull(),
  pickNumber: integer("pick_number"),
  originalTeamId: uuid("original_team_id").references(() => recTeams.id),
  currentTeamId: uuid("current_team_id").references(() => recTeams.id),
  source: text("source").notNull().default("manual_admin_entry"),
  manualLock: boolean("manual_lock").notNull().default(false),
  adminNotes: text("admin_notes"),
  createdByUserId: uuid("created_by_user_id").references(() => recUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recDraftPickAudit = pgTable("rec_draft_pick_audit", {
  id: uuid("id").primaryKey(),
  draftPickId: uuid("draft_pick_id").notNull().references(() => recDraftPicks.id),
  changedByUserId: uuid("changed_by_user_id").references(() => recUsers.id),
  changeType: text("change_type").notNull(),
  previousValue: jsonb("previous_value").$type<Record<string, unknown> | null>(),
  newValue: jsonb("new_value").$type<Record<string, unknown> | null>(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

// ============================================================================
// Media / audit
// ============================================================================

export const recMediaSubmissions = pgTable("rec_media_submissions", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").references(() => recLeagues.id),
  seasonId: uuid("season_id").references(() => recSeasons.id),
  submittedByUserId: uuid("submitted_by_user_id").references(() => recUsers.id),
  awardType: text("award_type").notNull(),
  playCategory: text("play_category"),
  title: text("title").notNull().default(""),
  description: text("description"),
  mediaUrl: text("media_url"),
  weekNumber: integer("week_number"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recMediaVotes = pgTable("rec_media_votes", {
  id: uuid("id").primaryKey(),
  submissionId: uuid("submission_id").notNull().references(() => recMediaSubmissions.id),
  voterUserId: uuid("voter_user_id").notNull().references(() => recUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recMediaAwards = pgTable("rec_media_awards", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").references(() => recLeagues.id),
  seasonId: uuid("season_id").references(() => recSeasons.id),
  awardType: text("award_type").notNull(),
  playCategory: text("play_category"),
  winningSubmissionId: uuid("winning_submission_id").references(() => recMediaSubmissions.id),
  winnerUserId: uuid("winner_user_id").references(() => recUsers.id),
  awardedAt: timestamp("awarded_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recAuditLogs = pgTable("rec_audit_logs", {
  id: uuid("id").primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => recUsers.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  previousValue: jsonb("previous_value").$type<Record<string, unknown> | null>(),
  newValue: jsonb("new_value").$type<Record<string, unknown> | null>(),
  reason: text("reason"),
  source: text("source").notNull().default("manual_admin_entry"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

// ============================================================================
// Non-REC-prefixed tables (gameday / user preferences)
// ============================================================================

// Non-REC-prefixed table — verify this is still in active use before relying on it.
export const gamedayOfferReminders = pgTable("gameday_offer_reminders", {
  id: integer("id").primaryKey(),
  offerId: integer("offer_id").notNull(),
  stage: text("stage").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }).notNull()
});

// Non-REC-prefixed table — verify this is still in active use before relying on it.
export const gamedayMatchupPanels = pgTable("gameday_matchup_panels", {
  id: integer("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id").notNull(),
  panelType: text("panel_type").notNull(),
  recGameId: bigint("rec_game_id", { mode: "number" }),
  gameScheduleId: integer("game_schedule_id"),
  seasonId: integer("season_id").notNull(),
  weekIndex: integer("week_index").notNull(),
  matchupKey: text("matchup_key"),
  awayDiscordId: text("away_discord_id"),
  homeDiscordId: text("home_discord_id"),
  awayTeamName: text("away_team_name"),
  homeTeamName: text("home_team_name"),
  stateJson: jsonb("state_json").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

// Non-REC-prefixed table — verify this is still in active use before relying on it.
export const userGamedayPreferences = pgTable("user_gameday_preferences", {
  discordId: text("discord_id").primaryKey(),
  defaultTimezone: text("default_timezone").notNull().default("CST"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export type RecGame = typeof recGames.$inferSelect;
export type RecGameResult = typeof recGameResults.$inferSelect;
export type RecGameSchedulingEvent = typeof recGameSchedulingEvents.$inferSelect;
export type RecDraftPick = typeof recDraftPicks.$inferSelect;
export type RecDraftPickAudit = typeof recDraftPickAudit.$inferSelect;
export type RecMediaSubmission = typeof recMediaSubmissions.$inferSelect;
export type RecMediaVote = typeof recMediaVotes.$inferSelect;
export type RecMediaAward = typeof recMediaAwards.$inferSelect;
export type RecAuditLog = typeof recAuditLogs.$inferSelect;
export type GamedayOfferReminder = typeof gamedayOfferReminders.$inferSelect;
export type GamedayMatchupPanel = typeof gamedayMatchupPanels.$inferSelect;
export type UserGamedayPreference = typeof userGamedayPreferences.$inferSelect;

// ============================================================================
// League configuration
// ============================================================================

export const recLeagueFeatureSettings = pgTable("rec_league_feature_settings", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  coinEconomyEnabled: boolean("coin_economy_enabled").notNull().default(true),
  customPlayersEnabled: boolean("custom_players_enabled").notNull().default(false),
  legendsEnabled: boolean("legends_enabled").notNull().default(false),
  devUpgradesEnabled: boolean("dev_upgrades_enabled").notNull().default(false),
  ageResetsEnabled: boolean("age_resets_enabled").notNull().default(false),
  trainingPackagesEnabled: boolean("training_packages_enabled").notNull().default(false),
  contractAdjustmentPurchasesEnabled: boolean("contract_adjustment_purchases_enabled").notNull().default(false),
  draftClassFeaturesEnabled: boolean("draft_class_features_enabled").notNull().default(false),
  scoutingPurchasesEnabled: boolean("scouting_purchases_enabled").notNull().default(false),
  mediaFeaturesEnabled: boolean("media_features_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  draftClassType: text("draft_class_type").notNull().default("auto_gen"),
  coinEconomyMinimumLinkedUsers: integer("coin_economy_minimum_linked_users").notNull().default(8),
  coinEconomyRequiresImportedGameUsers: boolean("coin_economy_requires_imported_game_users").notNull().default(true)
});

export const recLeagueConfiguration = pgTable("rec_league_configuration", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  rosterType: text("roster_type").notNull().default("regular_rosters"),
  coinEconomyEnabled: boolean("coin_economy_enabled").notNull().default(false),
  coinEconomyMinimumLinkedUsers: integer("coin_economy_minimum_linked_users").notNull().default(8),
  customPlayersEnabled: boolean("custom_players_enabled").notNull().default(false),
  legendsEnabled: boolean("legends_enabled").notNull().default(false),
  devUpgradesEnabled: boolean("dev_upgrades_enabled").notNull().default(false),
  ageResetsEnabled: boolean("age_resets_enabled").notNull().default(false),
  contractAdjustmentPurchasesEnabled: boolean("contract_adjustment_purchases_enabled").notNull().default(false),
  mediaFeaturesEnabled: boolean("media_features_enabled").notNull().default(true),
  streamingRequirement: text("streaming_requirement").notNull().default("recommended"),
  streamingScope: text("streaming_scope").notNull().default("every_game"),
  streamingSide: text("streaming_side").notNull().default("either"),
  fourthDownRuleType: text("fourth_down_rule_type").notNull().default("standard_rec"),
  customFourthDownRule: text("custom_fourth_down_rule"),
  positionChangePolicy: text("position_change_policy").notNull().default("restricted"),
  positionChangePolicyDescription: text("position_change_policy_description").notNull(),
  customPlaybooksAllowed: boolean("custom_playbooks_allowed").notNull().default(false),
  tradeApprovalPolicy: text("trade_approval_policy").notNull().default("competition_committee_review"),
  cpuTradingAllowed: boolean("cpu_trading_allowed").notNull().default(true),
  cpuFreeAgencyPolicy: text("cpu_free_agency_policy").notNull().default("open"),
  injuryPolicy: text("injury_policy").notNull().default("on_standard"),
  difficulty: text("difficulty").notNull().default("all_madden"),
  quarterLengthMinutes: integer("quarter_length_minutes").notNull().default(8),
  acceleratedClockEnabled: boolean("accelerated_clock_enabled").notNull().default(true),
  acceleratedClockMinimumSeconds: integer("accelerated_clock_minimum_seconds").notNull().default(20),
  salaryCapEnabled: boolean("salary_cap_enabled").notNull().default(false),
  tradeDeadlineEnabled: boolean("trade_deadline_enabled").notNull().default(false),
  abilitiesEnabled: boolean("abilities_enabled").notNull().default(true),
  wearAndTearEnabled: boolean("wear_and_tear_enabled").notNull().default(true),
  offensivePlayCallLimitsEnabled: boolean("offensive_play_call_limits_enabled").notNull().default(false),
  offensivePlayCallLimit: integer("offensive_play_call_limit"),
  offensivePlayCallCooldown: integer("offensive_play_call_cooldown"),
  defensivePlayCallLimitsEnabled: boolean("defensive_play_call_limits_enabled").notNull().default(false),
  defensivePlayCallLimit: integer("defensive_play_call_limit"),
  defensivePlayCallCooldown: integer("defensive_play_call_cooldown"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  regularSeasonStreamingRequirement: text("regular_season_streaming_requirement").notNull().default("recommended"),
  postseasonStreamingRequirement: text("postseason_streaming_requirement").notNull().default("required"),
  offensivePlayCallCooldownEnabled: boolean("offensive_play_call_cooldown_enabled").notNull().default(false),
  defensivePlayCallCooldownEnabled: boolean("defensive_play_call_cooldown_enabled").notNull().default(false),
  fairSimRequirements: text("fair_sim_requirements"),
  forceWinRequirements: text("force_win_requirements"),
  customCoachesRequired: boolean("custom_coaches_required").notNull().default(false),
  coachAbilitiesRestricted: boolean("coach_abilities_restricted").notNull().default(false),
  coachAbilitiesRestrictionNotes: text("coach_abilities_restriction_notes"),
  leaguePassword: text("league_password"),
  attributePurchasesEnabled: boolean("attribute_purchases_enabled").notNull().default(false),
  playerTraitPurchasesEnabled: boolean("player_trait_purchases_enabled").notNull().default(false),
  fourthDownRuleTypeRegular: text("fourth_down_rule_type_regular").notNull().default("standard_rec"),
  fourthDownRuleTypePlayoff: text("fourth_down_rule_type_playoff").notNull().default("standard_rec"),
  customFourthDownRuleRegular: text("custom_fourth_down_rule_regular"),
  customFourthDownRulePlayoff: text("custom_fourth_down_rule_playoff"),
  cpuTradingPolicy: text("cpu_trading_policy").notNull().default("allowed"),
  cpuTradingRestriction: text("cpu_trading_restriction"),
  difficultyCustomSettings: text("difficulty_custom_settings"),
  defaultScheduleSeedRequested: boolean("default_schedule_seed_requested").notNull().default(false),
  defaultScheduleSeededAt: timestamp("default_schedule_seeded_at", { withTimezone: true, mode: "string" }),
  regularSeasonStreamingSide: text("regular_season_streaming_side"),
  postseasonStreamingSide: text("postseason_streaming_side"),
  customPlayersSeasonCap: integer("custom_players_season_cap").notNull().default(0),
  legendsSeasonCap: integer("legends_season_cap").notNull().default(0),
  devUpgradesSeasonCap: integer("dev_upgrades_season_cap").notNull().default(0),
  ageResetsSeasonCap: integer("age_resets_season_cap").notNull().default(0),
  playerTraitPurchasesSeasonCap: integer("player_trait_purchases_season_cap").notNull().default(0),
  contractPurchasesSeasonCap: integer("contract_purchases_season_cap").notNull().default(0),
  coreAttributePurchasesSeasonCap: integer("core_attribute_purchases_season_cap").notNull().default(0),
  nonCoreAttributePurchasesSeasonCap: integer("non_core_attribute_purchases_season_cap").notNull().default(0),
  coreAttributes: jsonb("core_attributes").$type<Record<string, unknown> | null>(),
  dynastyType: text("dynasty_type"),
  recruitingDifficulty: text("recruiting_difficulty"),
  transferPortalEnabled: boolean("transfer_portal_enabled"),
  coachCarouselEnabled: boolean("coach_carousel_enabled"),
  conferenceRealignment: text("conference_realignment"),
  homeFieldAdvantageEnabled: boolean("home_field_advantage_enabled"),
  stadiumPulseEnabled: boolean("stadium_pulse_enabled"),
  teamBuilderAllowed: boolean("team_builder_allowed"),
  coreAttributeCapOverrides: jsonb("core_attribute_cap_overrides").$type<Record<string, unknown> | null>(),
  activeRostersEnabled: boolean("active_rosters_enabled"),
  coachFiringPolicy: text("coach_firing_policy").notNull().default("on"),
  preorderBonusesEnabled: boolean("preorder_bonuses_enabled").notNull().default(true),
  coachModeEnabled: boolean("coach_mode_enabled").notNull().default(false),
  coachModeAutoPassEnabled: boolean("coach_mode_auto_pass_enabled").notNull().default(false),
  coachModeAutoSnapEnabled: boolean("coach_mode_auto_snap_enabled").notNull().default(false),
  coachModeCoachSuggestionsEnabled: boolean("coach_mode_coach_suggestions_enabled").notNull().default(false),
  coachModeRecruitFlippingEnabled: boolean("coach_mode_recruit_flipping_enabled"),
  coachModeAutoRecruitingEnabled: boolean("coach_mode_auto_recruiting_enabled"),
  coachModeAutoProgressPlayersEnabled: boolean("coach_mode_auto_progress_players_enabled"),
  coachModeUserAutoProgressionEnabled: boolean("coach_mode_user_auto_progression_enabled"),
  coachModeCpuManageBudgetEnabled: boolean("coach_mode_cpu_manage_budget_enabled"),
  coachModeCpuManageStaffEnabled: boolean("coach_mode_cpu_manage_staff_enabled"),
  coachModeCpuManageFacilitiesEnabled: boolean("coach_mode_cpu_manage_facilities_enabled"),
  ballHawk: text("ball_hawk").notNull().default("keep_individual"),
  heatSeeker: text("heat_seeker").notNull().default("keep_individual"),
  switchAssist: text("switch_assist").notNull().default("keep_individual")
});

export type RecLeagueFeatureSettings = typeof recLeagueFeatureSettings.$inferSelect;
export type RecLeagueConfiguration = typeof recLeagueConfiguration.$inferSelect;

// ============================================================================
// Head-to-head records / user records
// ============================================================================

export const recUserHeadToHeadRecords = pgTable("rec_user_head_to_head_records", {
  id: uuid("id").primaryKey(),
  userAId: uuid("user_a_id").notNull().references(() => recUsers.id),
  userBId: uuid("user_b_id").notNull().references(() => recUsers.id),
  userAWins: integer("user_a_wins").notNull().default(0),
  userALosses: integer("user_a_losses").notNull().default(0),
  userATies: integer("user_a_ties").notNull().default(0),
  userAPointDifferential: integer("user_a_point_differential").notNull().default(0),
  userAPointsFor: integer("user_a_points_for").notNull().default(0),
  userAPointsAgainst: integer("user_a_points_against").notNull().default(0),
  userAPlayoffWins: integer("user_a_playoff_wins").notNull().default(0),
  userAPlayoffLosses: integer("user_a_playoff_losses").notNull().default(0),
  userAPlayoffTies: integer("user_a_playoff_ties").notNull().default(0),
  userAPlayoffPointDifferential: integer("user_a_playoff_point_differential").notNull().default(0),
  userASuperbowlWins: integer("user_a_superbowl_wins").notNull().default(0),
  userASuperbowlLosses: integer("user_a_superbowl_losses").notNull().default(0),
  userASuperbowlTies: integer("user_a_superbowl_ties").notNull().default(0),
  userASuperbowlPointDifferential: integer("user_a_superbowl_point_differential").notNull().default(0),
  totalGames: integer("total_games").notNull().default(0),
  playoffGames: integer("playoff_games").notNull().default(0),
  superbowlGames: integer("superbowl_games").notNull().default(0),
  averagePointDifferential: numeric("average_point_differential"),
  lastGameId: uuid("last_game_id").references(() => recGames.id),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recUserRecords = pgTable("rec_user_records", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  regularSeasonWins: integer("regular_season_wins").notNull().default(0),
  regularSeasonLosses: integer("regular_season_losses").notNull().default(0),
  regularSeasonTies: integer("regular_season_ties").notNull().default(0),
  playoffWins: integer("playoff_wins").notNull().default(0),
  playoffLosses: integer("playoff_losses").notNull().default(0),
  superBowlWins: integer("super_bowl_wins").notNull().default(0),
  superBowlLosses: integer("super_bowl_losses").notNull().default(0),
  cpuWins: integer("cpu_wins").notNull().default(0),
  cpuLosses: integer("cpu_losses").notNull().default(0),
  h2hWins: integer("h2h_wins").notNull().default(0),
  h2hLosses: integer("h2h_losses").notNull().default(0),
  h2hTies: integer("h2h_ties").notNull().default(0),
  pointsFor: integer("points_for").notNull().default(0),
  pointsAgainst: integer("points_against").notNull().default(0),
  pointDifferential: integer("point_differential"),
  largestWinMargin: integer("largest_win_margin"),
  largestLossMargin: integer("largest_loss_margin"),
  highestScoringGamePoints: integer("highest_scoring_game_points"),
  closestWinMargin: integer("closest_win_margin"),
  closestLossMargin: integer("closest_loss_margin"),
  longestWinStreak: integer("longest_win_streak").notNull().default(0),
  longestLosingStreak: integer("longest_losing_streak").notNull().default(0),
  currentWinStreak: integer("current_win_streak").notNull().default(0),
  currentLosingStreak: integer("current_losing_streak").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  lastGameId: uuid("last_game_id").references(() => recGameResults.id),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

// ============================================================================
// EOS payouts / weekly challenges
// ============================================================================

export const recEosPayoutBatches = pgTable("rec_eos_payout_batches", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  batchType: text("batch_type").notNull().default("eos_regular_season"),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdByUserId: uuid("created_by_user_id").references(() => recUsers.id),
  clearedByUserId: uuid("cleared_by_user_id").references(() => recUsers.id),
  clearReason: text("clear_reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
  clearedAt: timestamp("cleared_at", { withTimezone: true, mode: "string" }),
  issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recEosPayoutItems = pgTable("rec_eos_payout_items", {
  id: uuid("id").primaryKey(),
  batchId: uuid("batch_id").notNull().references(() => recEosPayoutBatches.id),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  seasonNumber: integer("season_number").notNull(),
  payoutCategory: text("payout_category").notNull(),
  payoutKey: text("payout_key").notNull(),
  payoutLabel: text("payout_label").notNull(),
  sourceEntityType: text("source_entity_type"),
  sourceEntityId: text("source_entity_id"),
  sourceEntityName: text("source_entity_name"),
  sourceEntityPosition: text("source_entity_position"),
  qualifiedTier: text("qualified_tier"),
  qualifiedValue: numeric("qualified_value"),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("pending"),
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  deniedReason: text("denied_reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  approvedByUserId: uuid("approved_by_user_id").references(() => recUsers.id),
  deniedByUserId: uuid("denied_by_user_id").references(() => recUsers.id),
  issuedLedgerId: uuid("issued_ledger_id").references(() => recDollarLedger.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  deniedAt: timestamp("denied_at", { withTimezone: true, mode: "string" }),
  issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  userApprovedAt: timestamp("user_approved_at", { withTimezone: true, mode: "string" }),
  commissionerUserId: uuid("commissioner_user_id").references(() => recUsers.id)
});

export const recWeeklyChallenges = pgTable("rec_weekly_challenges", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  gameId: uuid("game_id").references(() => recGames.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  teamId: uuid("team_id").notNull().references(() => recTeams.id),
  opponentTeamId: uuid("opponent_team_id").references(() => recTeams.id),
  opponentUserId: uuid("opponent_user_id").references(() => recUsers.id),
  isCpuGame: boolean("is_cpu_game").notNull().default(false),
  challengeSide: text("challenge_side").notNull(),
  challengeKey: text("challenge_key").notNull(),
  targetType: text("target_type").notNull().default("team"),
  targetPlayerExternalId: text("target_player_external_id"),
  targetPlayerName: text("target_player_name"),
  targetPlayerPosition: text("target_player_position"),
  sTierGoal: text("s_tier_goal").notNull(),
  aTierGoal: text("a_tier_goal").notNull(),
  bTierGoal: text("b_tier_goal").notNull().default("Win the game"),
  status: text("status").notNull().default("active"),
  earnedTier: text("earned_tier"),
  earnedAmount: integer("earned_amount").notNull().default(0),
  evaluationDetails: jsonb("evaluation_details").$type<Record<string, unknown> | null>(),
  generatedAt: timestamp("generated_at", { withTimezone: true, mode: "string" }).notNull(),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true, mode: "string" }),
  paidLedgerId: uuid("paid_ledger_id").references(() => recDollarLedger.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

// ============================================================================
// Game channels
// ============================================================================

export const recGameChannels = pgTable("rec_game_channels", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  gameId: uuid("game_id").references(() => recGames.id),
  discordChannelId: text("discord_channel_id").notNull(),
  awayTeamId: uuid("away_team_id").references(() => recTeams.id),
  homeTeamId: uuid("home_team_id").references(() => recTeams.id),
  awayUserId: uuid("away_user_id").references(() => recUsers.id),
  homeUserId: uuid("home_user_id").references(() => recUsers.id),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recGameChannelCheckins = pgTable("rec_game_channel_checkins", {
  id: uuid("id").primaryKey(),
  gameChannelId: uuid("game_channel_id").notNull().references(() => recGameChannels.id),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  discordChannelId: text("discord_channel_id").notNull(),
  discordUserId: text("discord_user_id").notNull(),
  userId: uuid("user_id").references(() => recUsers.id),
  firstMessageAt: timestamp("first_message_at", { withTimezone: true, mode: "string" }).notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "string" }).notNull(),
  messageCount: integer("message_count").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recGameChannelReminders = pgTable("rec_game_channel_reminders", {
  id: uuid("id").primaryKey(),
  gameChannelId: uuid("game_channel_id").notNull().references(() => recGameChannels.id),
  reminderType: text("reminder_type").notNull(),
  targetUserId: uuid("target_user_id").references(() => recUsers.id),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }).notNull(),
  details: jsonb("details").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recWeeklyPlayerAwards = pgTable("rec_weekly_player_awards", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  conference: text("conference").notNull(),
  awardSide: text("award_side").notNull(),
  awardSource: text("award_source").notNull().default("rec_calculated"),
  playerExternalId: text("player_external_id"),
  playerName: text("player_name").notNull(),
  position: text("position"),
  teamId: uuid("team_id").references(() => recTeams.id),
  userId: uuid("user_id").references(() => recUsers.id),
  score: numeric("score"),
  payoutAmount: integer("payout_amount").notNull().default(10),
  paidLedgerId: uuid("paid_ledger_id").references(() => recDollarLedger.id),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

// ============================================================================
// Game of the Week
// ============================================================================

export const recGameOfWeekCandidates = pgTable("rec_game_of_week_candidates", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  gameId: uuid("game_id").references(() => recGames.id),
  stage: text("stage").notNull().default("regular_season"),
  awayTeamId: uuid("away_team_id").references(() => recTeams.id),
  homeTeamId: uuid("home_team_id").references(() => recTeams.id),
  awayUserId: uuid("away_user_id").references(() => recUsers.id),
  homeUserId: uuid("home_user_id").references(() => recUsers.id),
  awayTeamName: text("away_team_name").notNull().default(""),
  homeTeamName: text("home_team_name").notNull().default(""),
  matchupTitle: text("matchup_title").notNull().default(""),
  strengthRating: numeric("strength_rating").notNull().default("0"),
  ratingBreakdown: jsonb("rating_breakdown").$type<Record<string, unknown> | null>(),
  previousGotwUserFlag: boolean("previous_gotw_user_flag").notNull().default(false),
  impactModifier: numeric("impact_modifier").notNull().default("0"),
  isSelected: boolean("is_selected").notNull().default(false),
  selectionSource: text("selection_source").notNull().default("admin_select"),
  selectedByDiscordId: text("selected_by_discord_id"),
  selectedAt: timestamp("selected_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recGameOfWeekPolls = pgTable("rec_game_of_week_polls", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  stage: text("stage").notNull(),
  gameId: uuid("game_id").references(() => recGames.id),
  candidateId: uuid("candidate_id").references(() => recGameOfWeekCandidates.id),
  question: text("question").notNull(),
  awayTeamId: uuid("away_team_id").references(() => recTeams.id),
  homeTeamId: uuid("home_team_id").references(() => recTeams.id),
  awayTeamName: text("away_team_name").notNull().default(""),
  homeTeamName: text("home_team_name").notNull().default(""),
  discordChannelId: text("discord_channel_id"),
  discordThreadId: text("discord_thread_id"),
  discordMessageId: text("discord_message_id"),
  pollExpiresAt: timestamp("poll_expires_at", { withTimezone: true, mode: "string" }),
  status: text("status").notNull().default("open"),
  winningTeamId: uuid("winning_team_id").references(() => recTeams.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
  settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  awayUserId: uuid("away_user_id").references(() => recUsers.id),
  homeUserId: uuid("home_user_id").references(() => recUsers.id),
  voteDeadlineDisplay: jsonb("vote_deadline_display").$type<Record<string, unknown> | null>()
});

export const recGameOfWeekVotes = pgTable("rec_game_of_week_votes", {
  id: uuid("id").primaryKey(),
  pollId: uuid("poll_id").notNull().references(() => recGameOfWeekPolls.id),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  userId: uuid("user_id").references(() => recUsers.id),
  discordId: text("discord_id").notNull(),
  selectedTeamId: uuid("selected_team_id").references(() => recTeams.id),
  selectedTeamName: text("selected_team_name").notNull().default(""),
  isCorrect: boolean("is_correct"),
  payoutAmount: integer("payout_amount").notNull().default(0),
  paidLedgerId: uuid("paid_ledger_id").references(() => recDollarLedger.id),
  votedAt: timestamp("voted_at", { withTimezone: true, mode: "string" }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recGlobalGotwGuessingRecords = pgTable("rec_global_gotw_guessing_records", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  correctGuesses: integer("correct_guesses").notNull().default(0),
  wrongGuesses: integer("wrong_guesses").notNull().default(0),
  totalGuesses: integer("total_guesses"),
  lastResultAt: timestamp("last_result_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export type RecUserHeadToHeadRecord = typeof recUserHeadToHeadRecords.$inferSelect;
export type RecUserRecord = typeof recUserRecords.$inferSelect;
export type RecEosPayoutBatch = typeof recEosPayoutBatches.$inferSelect;
export type RecEosPayoutItem = typeof recEosPayoutItems.$inferSelect;
export type RecWeeklyChallenge = typeof recWeeklyChallenges.$inferSelect;
export type RecGameChannel = typeof recGameChannels.$inferSelect;
export type RecGameChannelCheckin = typeof recGameChannelCheckins.$inferSelect;
export type RecGameChannelReminder = typeof recGameChannelReminders.$inferSelect;
export type RecWeeklyPlayerAward = typeof recWeeklyPlayerAwards.$inferSelect;
export type RecGameOfWeekCandidate = typeof recGameOfWeekCandidates.$inferSelect;
export type RecGameOfWeekPoll = typeof recGameOfWeekPolls.$inferSelect;
export type RecGameOfWeekVote = typeof recGameOfWeekVotes.$inferSelect;
export type RecGlobalGotwGuessingRecord = typeof recGlobalGotwGuessingRecords.$inferSelect;

// ============================================================================
// Players / rosters / stats
// ============================================================================

export const recPlayers = pgTable("rec_players", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  maddenPlayerId: text("madden_player_id").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  fullName: text("full_name"),
  position: text("position"),
  birthYear: integer("birth_year"),
  college: text("college"),
  heightInches: integer("height_inches"),
  weightLbs: integer("weight_lbs"),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  devTrait: text("dev_trait"),
  overallRating: integer("overall_rating"),
  scheme: integer("scheme"),
  yearsPro: integer("years_pro"),
  resignStatus: integer("resign_status"),
  contractYearsLeft: integer("contract_years_left"),
  contractSalary: bigint("contract_salary", { mode: "number" }),
  capHit: bigint("cap_hit", { mode: "number" }),
  capReleasePenalty: bigint("cap_release_penalty", { mode: "number" }),
  capReleaseNetSavings: bigint("cap_release_net_savings", { mode: "number" }),
  isFreeAgent: boolean("is_free_agent"),
  isXfactor: boolean("is_xfactor"),
  abilityCount: integer("ability_count"),
  teamId: uuid("team_id")
});

export const recRosterSnapshots = pgTable("rec_roster_snapshots", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number"),
  seasonIndex: integer("season_index"),
  weekNumber: integer("week_number"),
  teamId: uuid("team_id").references(() => recTeams.id),
  playerId: uuid("player_id").references(() => recPlayers.id),
  maddenTeamId: text("madden_team_id"),
  maddenPlayerId: text("madden_player_id").notNull(),
  playerName: text("player_name"),
  position: text("position"),
  jerseyNumber: integer("jersey_number"),
  overallRating: integer("overall_rating"),
  age: integer("age"),
  devTrait: text("dev_trait"),
  isFreeAgent: boolean("is_free_agent").notNull().default(false),
  isActive: boolean("is_active"),
  isOnIr: boolean("is_on_ir"),
  isOnPracticeSquad: boolean("is_on_practice_squad"),
  contractSalary: integer("contract_salary"),
  contractBonus: integer("contract_bonus"),
  contractYearsLeft: integer("contract_years_left"),
  ratings: jsonb("ratings").$type<Record<string, unknown> | null>(),
  traits: jsonb("traits").$type<Record<string, unknown> | null>(),
  contract: jsonb("contract").$type<Record<string, unknown> | null>(),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recPlayerWeeklyStats = pgTable("rec_player_weekly_stats", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number"),
  seasonIndex: integer("season_index"),
  seasonStage: text("season_stage").notNull().default("regular_season"),
  weekNumber: integer("week_number"),
  playerId: uuid("player_id").references(() => recPlayers.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  maddenPlayerId: text("madden_player_id").notNull(),
  maddenTeamId: text("madden_team_id"),
  playerName: text("player_name"),
  teamName: text("team_name"),
  position: text("position"),
  statCategory: text("stat_category").notNull(),
  stats: jsonb("stats").$type<Record<string, unknown> | null>(),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  guildId: text("guild_id"),
  sourceStatId: text("source_stat_id"),
  sourceScheduleId: text("source_schedule_id"),
  sourceStageIndex: integer("source_stage_index"),
  sourceWeekIndex: integer("source_week_index"),
  sourceTeamId: text("source_team_id"),
  sourceRosterId: text("source_roster_id")
});

export const recTeamWeeklyStats = pgTable("rec_team_weekly_stats", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number"),
  seasonIndex: integer("season_index"),
  seasonStage: text("season_stage").notNull().default("regular_season"),
  weekNumber: integer("week_number"),
  teamId: uuid("team_id").references(() => recTeams.id),
  maddenTeamId: text("madden_team_id").notNull(),
  teamName: text("team_name"),
  statCategory: text("stat_category").notNull().default("team"),
  stats: jsonb("stats").$type<Record<string, unknown> | null>(),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recUserH2hGlobalRecords = pgTable("rec_user_h2h_global_records", {
  id: uuid("id").primaryKey(),
  userAId: uuid("user_a_id").notNull().references(() => recUsers.id),
  userBId: uuid("user_b_id").notNull().references(() => recUsers.id),
  userAWins: integer("user_a_wins").notNull().default(0),
  userALosses: integer("user_a_losses").notNull().default(0),
  userATies: integer("user_a_ties").notNull().default(0),
  userAPointsFor: integer("user_a_points_for").notNull().default(0),
  userAPointsAgainst: integer("user_a_points_against").notNull().default(0),
  userAPointDifferential: integer("user_a_point_differential").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  avgUserAPointDifferential: numeric("avg_user_a_point_differential").notNull().default("0"),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recUserH2hLeagueRecords = pgTable("rec_user_h2h_league_records", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  userAId: uuid("user_a_id").notNull().references(() => recUsers.id),
  userBId: uuid("user_b_id").notNull().references(() => recUsers.id),
  userAWins: integer("user_a_wins").notNull().default(0),
  userALosses: integer("user_a_losses").notNull().default(0),
  userATies: integer("user_a_ties").notNull().default(0),
  userAPointsFor: integer("user_a_points_for").notNull().default(0),
  userAPointsAgainst: integer("user_a_points_against").notNull().default(0),
  userAPointDifferential: integer("user_a_point_differential").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  avgUserAPointDifferential: numeric("avg_user_a_point_differential").notNull().default("0"),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recLeagueRecords = pgTable("rec_league_records", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  recordName: text("record_name").notNull(),
  recordValue: numeric("record_value").notNull(),
  recordHolderId: uuid("record_holder_id").references(() => recUsers.id),
  previousHolderId: uuid("previous_holder_id").references(() => recUsers.id),
  previousValue: numeric("previous_value"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  seasonEndedAt: timestamp("season_ended_at", { withTimezone: true, mode: "string" })
});

export const recPowerRankings = pgTable("rec_power_rankings", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  teamId: uuid("team_id").references(() => recTeams.id),
  userId: uuid("user_id"),
  rank: integer("rank").notNull(),
  previousRank: integer("previous_rank"),
  rankChange: integer("rank_change"),
  score: numeric("score").notNull().default("0"),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  ties: integer("ties").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  pointDifferential: numeric("point_differential").notNull().default("0"),
  winPct: numeric("win_pct").notNull().default("0"),
  avgPdPerGame: numeric("avg_pd_per_game").notNull().default("0"),
  sosScore: numeric("sos_score").notNull().default("0"),
  recentFormScore: numeric("recent_form_score").notNull().default("0"),
  teamOvrScore: numeric("team_ovr_score").notNull().default("0"),
  offenseOvr: numeric("offense_ovr"),
  defenseOvr: numeric("defense_ovr"),
  statLeaderPlayerName: text("stat_leader_player_name"),
  statLeaderPosition: text("stat_leader_position"),
  statLeaderStatLine: text("stat_leader_stat_line"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export type RecPlayer = typeof recPlayers.$inferSelect;
export type RecRosterSnapshot = typeof recRosterSnapshots.$inferSelect;
export type RecPlayerWeeklyStats = typeof recPlayerWeeklyStats.$inferSelect;
export type RecTeamWeeklyStats = typeof recTeamWeeklyStats.$inferSelect;
export type RecUserH2hGlobalRecord = typeof recUserH2hGlobalRecords.$inferSelect;
export type RecUserH2hLeagueRecord = typeof recUserH2hLeagueRecords.$inferSelect;
export type RecLeagueRecord = typeof recLeagueRecords.$inferSelect;
export type RecPowerRanking = typeof recPowerRankings.$inferSelect;

// ============================================================================
// EOS award polls / highlights / nominations
// ============================================================================

export const recEosAwardPolls = pgTable("rec_eos_award_polls", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  categoryKey: text("category_key").notNull(),
  categoryLabel: text("category_label").notNull(),
  categoryDescription: text("category_description"),
  status: text("status").notNull().default("open"),
  winnerUserId: uuid("winner_user_id").references(() => recUsers.id),
  openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull(),
  closesAt: timestamp("closes_at", { withTimezone: true, mode: "string" }),
  lockedAt: timestamp("locked_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  tiebreakerNeeded: boolean("tiebreaker_needed").notNull().default(false),
  tiedCandidateIds: jsonb("tied_candidate_ids").$type<Record<string, unknown> | null>(),
  awardAmount: integer("award_amount").notNull().default(200),
  nomineeUserIds: jsonb("nominee_user_ids").$type<Record<string, unknown> | null>(),
  nomineePayloads: jsonb("nominee_payloads").$type<Record<string, unknown> | null>(),
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }),
  paidLedgerId: uuid("paid_ledger_id").references(() => recDollarLedger.id),
  voteCounts: jsonb("vote_counts").$type<Record<string, unknown> | null>()
});

export const recEosAwardVotes = pgTable("rec_eos_award_votes", {
  id: uuid("id").primaryKey(),
  pollId: uuid("poll_id").notNull().references(() => recEosAwardPolls.id),
  voterUserId: uuid("voter_user_id").notNull().references(() => recUsers.id),
  nomineeUserId: uuid("nominee_user_id").notNull().references(() => recUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recHighlightPosts = pgTable("rec_highlight_posts", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  seasonStage: text("season_stage"),
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  messageUrl: text("message_url"),
  content: text("content"),
  isFirstThisWeek: boolean("is_first_this_week").notNull().default(false),
  payoutReviewId: uuid("payout_review_id"),
  payoutIssued: boolean("payout_issued").notNull().default(false),
  cloudflareStreamUid: text("cloudflare_stream_uid"),
  storageProvider: text("storage_provider").notNull().default("discord_mirror"),
  mediaStatus: text("media_status").notNull().default("ready"),
  playbackUrl: text("playback_url"),
  maxHeight: integer("max_height"),
  retainedAsPoty: boolean("retained_as_poty").notNull().default(false),
  hubVisible: boolean("hub_visible").notNull().default(false),
  gameId: uuid("game_id").references(() => recGames.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recHubAnnouncements = pgTable("rec_hub_announcements", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  seasonNumber: integer("season_number"),
  weekNumber: integer("week_number"),
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recHighlightReactions = pgTable("rec_highlight_reactions", {
  id: uuid("id").primaryKey(),
  highlightPostId: uuid("highlight_post_id").notNull().references(() => recHighlightPosts.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  reactionKey: text("reaction_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recHighlightViews = pgTable("rec_highlight_views", {
  id: uuid("id").primaryKey(),
  highlightPostId: uuid("highlight_post_id").notNull().references(() => recHighlightPosts.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recPotyNominations = pgTable("rec_poty_nominations", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  nominatorUserId: uuid("nominator_user_id").notNull().references(() => recUsers.id),
  nomineeUserId: uuid("nominee_user_id").notNull().references(() => recUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  potyCategory: text("poty_category"),
  highlightId: uuid("highlight_id"),
  highlightUrl: text("highlight_url")
});

export const recGotyNominations = pgTable("rec_goty_nominations", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  nominatorUserId: uuid("nominator_user_id").notNull().references(() => recUsers.id),
  nominatedGameId: uuid("nominated_game_id").references(() => recGameResults.id),
  homeTeamLabel: text("home_team_label"),
  awayTeamLabel: text("away_team_label"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  nominationNotes: text("nomination_notes")
});

export const recDevUpgradePrizes = pgTable("rec_dev_upgrade_prizes", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  userId: uuid("user_id").references(() => recUsers.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  playerName: text("player_name"),
  maddenPlayerId: text("madden_player_id"),
  oldDevTrait: text("old_dev_trait"),
  newDevTrait: text("new_dev_trait"),
  prizeAmount: integer("prize_amount").notNull().default(0),
  issued: boolean("issued").notNull().default(false),
  ledgerId: uuid("ledger_id"),
  importJobId: text("import_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

// ============================================================================
// Awards
// ============================================================================

export const recAwards = pgTable("rec_awards", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  seasonNumber: integer("season_number").notNull(),
  awardKey: text("award_key").notNull(),
  awardName: text("award_name").notNull(),
  awardCategory: text("award_category").notNull(),
  requiresVoting: boolean("requires_voting").notNull().default(true),
  status: text("status").notNull().default("pending"),
  votingMessageId: text("voting_message_id"),
  votingChannelId: text("voting_channel_id"),
  votingOpensAt: timestamp("voting_opens_at", { withTimezone: true, mode: "string" }),
  votingClosesAt: timestamp("voting_closes_at", { withTimezone: true, mode: "string" }),
  payoutAmount: numeric("payout_amount").notNull().default("100"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
});

export const recAwardNominees = pgTable("rec_award_nominees", {
  id: uuid("id").primaryKey(),
  awardId: uuid("award_id").notNull().references(() => recAwards.id),
  userId: uuid("user_id").notNull(),
  teamName: text("team_name"),
  performanceScore: numeric("performance_score").notNull().default("0"),
  voteCount: integer("vote_count").notNull().default(0),
  finalScore: numeric("final_score"),
  displayLabel: text("display_label"),
  rawStats: jsonb("raw_stats").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
  playerName: text("player_name"),
  playerId: uuid("player_id").references(() => recPlayers.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  nomineeType: text("nominee_type"),
  nomineeKey: text("nominee_key").notNull()
});

export const recAwardVotes = pgTable("rec_award_votes", {
  id: uuid("id").primaryKey(),
  awardId: uuid("award_id").notNull().references(() => recAwards.id),
  voterUserId: uuid("voter_user_id").notNull(),
  nomineeUserId: uuid("nominee_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
  nomineeKey: text("nominee_key")
});

export const recAwardWinners = pgTable("rec_award_winners", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  seasonNumber: integer("season_number").notNull(),
  awardKey: text("award_key").notNull(),
  awardName: text("award_name").notNull(),
  winnerUserId: uuid("winner_user_id").notNull(),
  winnerTeamName: text("winner_team_name"),
  winnerDiscordId: text("winner_discord_id"),
  performanceScore: numeric("performance_score"),
  voteCount: integer("vote_count").notNull().default(0),
  finalScore: numeric("final_score"),
  payoutAmount: numeric("payout_amount").notNull().default("100"),
  payoutIssued: boolean("payout_issued").notNull().default(false),
  payoutLedgerId: uuid("payout_ledger_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
});

export const recSeasonTeamSeeds = pgTable("rec_season_team_seeds", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  teamId: uuid("team_id").notNull().references(() => recTeams.id),
  conference: text("conference"),
  seed: integer("seed"),
  playoffStatus: integer("playoff_status"),
  madePlayoffs: boolean("made_playoffs").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  divisionName: text("division_name"),
  divisionWinner: boolean("division_winner").notNull().default(false)
});

export type RecEosAwardPoll = typeof recEosAwardPolls.$inferSelect;
export type RecEosAwardVote = typeof recEosAwardVotes.$inferSelect;
export type RecHighlightPost = typeof recHighlightPosts.$inferSelect;
export type RecPotyNomination = typeof recPotyNominations.$inferSelect;
export type RecGotyNomination = typeof recGotyNominations.$inferSelect;
export type RecDevUpgradePrize = typeof recDevUpgradePrizes.$inferSelect;
export type RecAward = typeof recAwards.$inferSelect;
export type RecAwardNominee = typeof recAwardNominees.$inferSelect;
export type RecAwardVote = typeof recAwardVotes.$inferSelect;
export type RecAwardWinner = typeof recAwardWinners.$inferSelect;
export type RecSeasonTeamSeed = typeof recSeasonTeamSeeds.$inferSelect;

// ============================================================================
// Active checks / stream compliance / rules
// ============================================================================

export const recActiveCheckEvents = pgTable("rec_active_check_events", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number"),
  weekNumber: integer("week_number"),
  status: text("status").notNull().default("open"),
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  createdByDiscordId: text("created_by_discord_id"),
  closesAt: timestamp("closes_at", { withTimezone: true, mode: "string" }),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recActiveCheckResponses = pgTable("rec_active_check_responses", {
  id: uuid("id").primaryKey(),
  eventId: uuid("event_id").notNull().references(() => recActiveCheckEvents.id),
  leagueId: uuid("league_id").notNull(),
  userId: uuid("user_id").notNull(),
  discordId: text("discord_id"),
  teamId: uuid("team_id"),
  respondedAt: timestamp("responded_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  responseType: text("response_type").notNull().default("active")
});

export const recActiveCheckMisses = pgTable("rec_active_check_misses", {
  id: uuid("id").primaryKey(),
  eventId: uuid("event_id").notNull().references(() => recActiveCheckEvents.id),
  leagueId: uuid("league_id").notNull(),
  userId: uuid("user_id").notNull(),
  teamId: uuid("team_id"),
  missedAt: timestamp("missed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  discordId: text("discord_id"),
  bootStatus: text("boot_status").notNull().default("pending")
});

export const recStreamComplianceLogs = pgTable("rec_stream_compliance_logs", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  gameId: uuid("game_id").references(() => recGames.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  required: boolean("required").notNull().default(false),
  complied: boolean("complied").notNull().default(false),
  requirement: text("requirement"),
  streamMessageId: text("stream_message_id"),
  streamChannelId: text("stream_channel_id"),
  checkedAt: timestamp("checked_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  messageUrl: text("message_url"),
  postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
  status: text("status").notNull().default("posted"),
  details: jsonb("details").$type<Record<string, unknown> | null>()
});

export const recGameChannelActivityPenalties = pgTable("rec_game_channel_activity_penalties", {
  id: uuid("id").primaryKey(),
  gameChannelId: uuid("game_channel_id").references(() => recGameChannels.id),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  penaltyType: text("penalty_type").notNull().default("no_12_hour_checkin"),
  penaltyWeight: integer("penalty_weight").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recRuleSections = pgTable("rec_rule_sections", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").references(() => recLeagues.id),
  ruleKey: text("rule_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  scope: text("scope").notNull().default("global_locked"),
  isEditable: boolean("is_editable").notNull().default(false),
  source: text("source").notNull().default("rec_default"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recStreamPayoutReviews = pgTable("rec_stream_payout_reviews", {
  id: uuid("id").primaryKey(),
  streamLogId: uuid("stream_log_id").references(() => recStreamComplianceLogs.id),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  status: text("status").notNull().default("pending"),
  amount: integer("amount").notNull().default(5),
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  reviewedByDiscordId: text("reviewed_by_discord_id"),
  deniedReason: text("denied_reason"),
  issuedLedgerId: uuid("issued_ledger_id").references(() => recDollarLedger.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recGlobalGotwH2hRecords = pgTable("rec_global_gotw_h2h_records", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  ties: integer("ties").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  lastResultAt: timestamp("last_result_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export type RecActiveCheckEvent = typeof recActiveCheckEvents.$inferSelect;
export type RecActiveCheckResponse = typeof recActiveCheckResponses.$inferSelect;
export type RecActiveCheckMiss = typeof recActiveCheckMisses.$inferSelect;
export type RecStreamComplianceLog = typeof recStreamComplianceLogs.$inferSelect;
export type RecGameChannelActivityPenalty = typeof recGameChannelActivityPenalties.$inferSelect;
export type RecRuleSection = typeof recRuleSections.$inferSelect;
export type RecStreamPayoutReview = typeof recStreamPayoutReviews.$inferSelect;
export type RecGlobalGotwH2hRecord = typeof recGlobalGotwH2hRecords.$inferSelect;

// ============================================================================
// Commissioner inbox / standings / box scores
// ============================================================================

export const recCommissionersInbox = pgTable("rec_commissioners_inbox", {
  id: uuid("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  serverId: uuid("server_id").references(() => recDiscordServers.id),
  leagueId: uuid("league_id").references(() => recLeagues.id),
  seasonNumber: integer("season_number"),
  weekNumber: integer("week_number"),
  queueType: text("queue_type").notNull(),
  status: text("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(0),
  header: text("header").notNull(),
  summary: text("summary"),
  requesterUserId: uuid("requester_user_id").references(() => recUsers.id),
  requesterDiscordId: text("requester_discord_id"),
  targetUserId: uuid("target_user_id").references(() => recUsers.id),
  targetDiscordId: text("target_discord_id"),
  teamId: uuid("team_id").references(() => recTeams.id),
  amount: numeric("amount"),
  sourceTable: text("source_table"),
  sourceId: uuid("source_id"),
  sourceReference: jsonb("source_reference").$type<Record<string, unknown> | null>(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  reviewChannelId: text("review_channel_id"),
  reviewMessageId: text("review_message_id"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => recUsers.id),
  reviewedByDiscordId: text("reviewed_by_discord_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  reviewReason: text("review_reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  dmNotifiedAt: timestamp("dm_notified_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recTeamStandingsSnapshots = pgTable("rec_team_standings_snapshots", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  seasonIndex: integer("season_index"),
  seasonStage: text("season_stage").notNull().default("regular_season"),
  weekNumber: integer("week_number"),
  teamId: uuid("team_id").notNull().references(() => recTeams.id),
  maddenTeamId: text("madden_team_id"),
  teamName: text("team_name"),
  conferenceId: integer("conference_id"),
  conferenceName: text("conference_name"),
  divisionId: integer("division_id"),
  divisionName: text("division_name"),
  totalWins: integer("total_wins").notNull().default(0),
  totalLosses: integer("total_losses").notNull().default(0),
  totalTies: integer("total_ties").notNull().default(0),
  homeWins: integer("home_wins"),
  homeLosses: integer("home_losses"),
  homeTies: integer("home_ties"),
  awayWins: integer("away_wins"),
  awayLosses: integer("away_losses"),
  awayTies: integer("away_ties"),
  conferenceWins: integer("conference_wins"),
  conferenceLosses: integer("conference_losses"),
  conferenceTies: integer("conference_ties"),
  divisionWins: integer("division_wins"),
  divisionLosses: integer("division_losses"),
  divisionTies: integer("division_ties"),
  winPct: numeric("win_pct"),
  winLossStreak: integer("win_loss_streak"),
  standingRank: integer("standing_rank"),
  previousRank: integer("previous_rank"),
  playoffSeed: integer("playoff_seed"),
  playoffStatus: integer("playoff_status"),
  madePlayoffs: boolean("made_playoffs").notNull().default(false),
  pointsFor: integer("points_for"),
  pointsAgainst: integer("points_against"),
  netPoints: integer("net_points"),
  turnoverDifferential: integer("turnover_differential"),
  teamOvr: integer("team_ovr"),
  capAvailable: bigint("cap_available", { mode: "number" }),
  capRoom: bigint("cap_room", { mode: "number" }),
  capSpent: bigint("cap_spent", { mode: "number" }),
  offensivePassYards: integer("offensive_pass_yards"),
  offensiveRushYards: integer("offensive_rush_yards"),
  offensiveTotalYards: integer("offensive_total_yards"),
  defensivePassYards: integer("defensive_pass_yards"),
  defensiveRushYards: integer("defensive_rush_yards"),
  defensiveTotalYards: integer("defensive_total_yards"),
  pointsForRank: integer("points_for_rank"),
  pointsAgainstRank: integer("points_against_rank"),
  offensivePassYardsRank: integer("offensive_pass_yards_rank"),
  offensiveRushYardsRank: integer("offensive_rush_yards_rank"),
  offensiveTotalYardsRank: integer("offensive_total_yards_rank"),
  defensivePassYardsRank: integer("defensive_pass_yards_rank"),
  defensiveRushYardsRank: integer("defensive_rush_yards_rank"),
  defensiveTotalYardsRank: integer("defensive_total_yards_rank"),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recBoxScoreSubmissions = pgTable("rec_box_score_submissions", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number"),
  weekNumber: integer("week_number"),
  phase: text("phase"),
  submittedByDiscordId: text("submitted_by_discord_id").notNull(),
  submittedByUserId: uuid("submitted_by_user_id").references(() => recUsers.id),
  discordGuildId: text("discord_guild_id"),
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  imageUrls: jsonb("image_urls").$type<Record<string, unknown> | null>(),
  team1Abbr: text("team1_abbr"),
  team2Abbr: text("team2_abbr"),
  homeTeamId: uuid("home_team_id").references(() => recTeams.id),
  awayTeamId: uuid("away_team_id").references(() => recTeams.id),
  homeUserId: uuid("home_user_id").references(() => recUsers.id),
  awayUserId: uuid("away_user_id").references(() => recUsers.id),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  quarterScores: jsonb("quarter_scores").$type<Record<string, unknown> | null>(),
  teamStats: jsonb("team_stats").$type<Record<string, unknown> | null>(),
  gameId: uuid("game_id").references(() => recGames.id),
  parseWarnings: jsonb("parse_warnings").$type<Record<string, unknown> | null>(),
  comebackDeficit: integer("comeback_deficit"),
  comebackDeficitQuarter: integer("comeback_deficit_quarter"),
  comebackRate: numeric("comeback_rate"),
  comebackWinnerTeamId: uuid("comeback_winner_team_id").references(() => recTeams.id),
  fourthQuarterComeback: boolean("fourth_quarter_comeback").notNull().default(false),
  status: text("status").notNull().default("draft"),
  reviewedByDiscordId: text("reviewed_by_discord_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  deniedReason: text("denied_reason"),
  payoutIssued: boolean("payout_issued").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  parseLabelSamples: jsonb("parse_label_samples").$type<Record<string, unknown> | null>(),
  team1Id: uuid("team1_id"),
  team2Id: uuid("team2_id"),
  flagged: boolean("flagged").notNull().default(false),
  flagReasons: jsonb("flag_reasons").$type<Record<string, unknown> | null>(),
  ledgerDiscordMessageId: text("ledger_discord_message_id"),
  imageStorageUrl: text("image_storage_url"),
  entryMethod: text("entry_method").notNull().default("box_score")
});

export const recOcrLabelAliases = pgTable("rec_ocr_label_aliases", {
  id: uuid("id").primaryKey(),
  rawLabel: text("raw_label").notNull(),
  canonicalKey: text("canonical_key").notNull(),
  hitCount: integer("hit_count").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recTeamGameStats = pgTable("rec_team_game_stats", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  phase: text("phase"),
  gameId: uuid("game_id"),
  submissionId: uuid("submission_id").notNull(),
  teamId: uuid("team_id"),
  opponentTeamId: uuid("opponent_team_id"),
  userId: uuid("user_id"),
  opponentUserId: uuid("opponent_user_id"),
  isHome: boolean("is_home"),
  result: text("result"),
  pointsFor: integer("points_for"),
  pointsAgainst: integer("points_against"),
  offYardsGained: integer("off_yards_gained"),
  offRushYards: integer("off_rush_yards"),
  offPassYards: integer("off_pass_yards"),
  offFirstDown: integer("off_first_down"),
  puntReturnYards: integer("punt_return_yards"),
  kickReturnYards: integer("kick_return_yards"),
  totalYardsGained: integer("total_yards_gained"),
  turnoversCommitted: integer("turnovers_committed"),
  redZoneOffPercentage: integer("red_zone_off_percentage"),
  generatedTurnovers: integer("generated_turnovers"),
  yardsAllowed: integer("yards_allowed"),
  rushYardsAllowed: integer("rush_yards_allowed"),
  passYardsAllowed: integer("pass_yards_allowed"),
  firstDownsAllowed: integer("first_downs_allowed"),
  redZoneDefPercentage: integer("red_zone_def_percentage"),
  comebackDeficit: integer("comeback_deficit"),
  comebackDeficitQuarter: integer("comeback_deficit_quarter"),
  comebackRate: numeric("comeback_rate"),
  fourthQuarterComeback: boolean("fourth_quarter_comeback").default(false),
  quarterScores: jsonb("quarter_scores").$type<Record<string, unknown> | null>(),
  offensiveStats: jsonb("offensive_stats").$type<Record<string, unknown> | null>(),
  defensiveStats: jsonb("defensive_stats").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recUserBoxScoreProfileStats = pgTable("rec_user_box_score_profile_stats", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  leagueId: uuid("league_id").references(() => recLeagues.id),
  seasonNumber: integer("season_number"),
  scope: text("scope").notNull(),
  gamesLogged: integer("games_logged").notNull().default(0),
  boxScoresUploaded: integer("box_scores_uploaded").notNull().default(0),
  totalYards: bigint("total_yards", { mode: "number" }).notNull().default(0),
  passingYards: bigint("passing_yards", { mode: "number" }).notNull().default(0),
  rushingYards: bigint("rushing_yards", { mode: "number" }).notNull().default(0),
  firstDowns: bigint("first_downs", { mode: "number" }).notNull().default(0),
  turnoversGenerated: bigint("turnovers_generated", { mode: "number" }).notNull().default(0),
  turnoversCommitted: bigint("turnovers_committed", { mode: "number" }).notNull().default(0),
  turnoverDifferential: bigint("turnover_differential", { mode: "number" }).notNull().default(0),
  redZoneOffPctAvg: integer("red_zone_off_pct_avg").notNull().default(0),
  redZoneDefPctAvg: integer("red_zone_def_pct_avg").notNull().default(0),
  activeStreak: text("active_streak").notNull().default("—"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recTeamLinkRequests = pgTable("rec_team_link_requests", {
  id: uuid("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  teamId: uuid("team_id").notNull().references(() => recTeams.id),
  requesterUserId: uuid("requester_user_id").notNull().references(() => recUsers.id),
  requesterDiscordId: text("requester_discord_id").notNull(),
  status: text("status").notNull().default("pending"),
  authority: text("authority"),
  assignedByUserId: uuid("assigned_by_user_id").references(() => recUsers.id),
  assignedByDiscordId: text("assigned_by_discord_id"),
  reviewChannelId: text("review_channel_id"),
  reviewMessageId: text("review_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" })
});

export const recSeasonUserDisplayRecords = pgTable("rec_season_user_display_records", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  ties: integer("ties").notNull().default(0),
  pointsFor: integer("points_for").notNull().default(0),
  pointsAgainst: integer("points_against").notNull().default(0),
  pointDifferential: integer("point_differential").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export type RecCommissionersInbox = typeof recCommissionersInbox.$inferSelect;
export type RecTeamStandingsSnapshot = typeof recTeamStandingsSnapshots.$inferSelect;
export type RecBoxScoreSubmission = typeof recBoxScoreSubmissions.$inferSelect;
export type RecOcrLabelAlias = typeof recOcrLabelAliases.$inferSelect;
export type RecTeamGameStats = typeof recTeamGameStats.$inferSelect;
export type RecUserBoxScoreProfileStats = typeof recUserBoxScoreProfileStats.$inferSelect;
export type RecTeamLinkRequest = typeof recTeamLinkRequests.$inferSelect;
export type RecSeasonUserDisplayRecord = typeof recSeasonUserDisplayRecords.$inferSelect;

// ============================================================================
// CPU stats / power ranking snapshots / game profiles & stories / badges
// ============================================================================

export const recCpuTeamSeasonStats = pgTable("rec_cpu_team_season_stats", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  teamId: uuid("team_id").notNull().references(() => recTeams.id),
  gamesLogged: integer("games_logged").notNull().default(0),
  boxScoresLogged: integer("box_scores_logged").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  ties: integer("ties").notNull().default(0),
  totalYards: bigint("total_yards", { mode: "number" }).notNull().default(0),
  passingYards: bigint("passing_yards", { mode: "number" }).notNull().default(0),
  rushingYards: bigint("rushing_yards", { mode: "number" }).notNull().default(0),
  firstDowns: bigint("first_downs", { mode: "number" }).notNull().default(0),
  turnoversGenerated: bigint("turnovers_generated", { mode: "number" }).notNull().default(0),
  turnoversCommitted: bigint("turnovers_committed", { mode: "number" }).notNull().default(0),
  turnoverDifferential: bigint("turnover_differential", { mode: "number" }).notNull().default(0),
  redZoneOffPctAvg: integer("red_zone_off_pct_avg").notNull().default(0),
  redZoneDefPctAvg: integer("red_zone_def_pct_avg").notNull().default(0),
  activeStreak: text("active_streak").notNull().default("—"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recGlobalUserGameRecords = pgTable("rec_global_user_game_records", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  game: text("game").notNull(),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  ties: integer("ties").notNull().default(0),
  playoffWins: integer("playoff_wins").notNull().default(0),
  playoffLosses: integer("playoff_losses").notNull().default(0),
  superbowlWins: integer("superbowl_wins").notNull().default(0),
  superbowlLosses: integer("superbowl_losses").notNull().default(0),
  pointsFor: integer("points_for").notNull().default(0),
  pointsAgainst: integer("points_against").notNull().default(0),
  pointDifferential: integer("point_differential").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  avgPointDifferential: numeric("avg_point_differential").notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recHighlightPayoutReviews = pgTable("rec_highlight_payout_reviews", {
  id: uuid("id").primaryKey(),
  highlightPostId: uuid("highlight_post_id").notNull().references(() => recHighlightPosts.id),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  teamId: uuid("team_id").references(() => recTeams.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  payoutKind: text("payout_kind").notNull().default("weekly_highlight"),
  awardCategory: text("award_category"),
  voteCount: integer("vote_count"),
  status: text("status").notNull().default("pending"),
  amount: integer("amount").notNull().default(25),
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  reviewedByDiscordId: text("reviewed_by_discord_id"),
  deniedReason: text("denied_reason"),
  issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  issuedLedgerId: uuid("issued_ledger_id").references(() => recDollarLedger.id)
});

export const recPowerRankingSnapshots = pgTable("rec_power_ranking_snapshots", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  teamId: uuid("team_id").notNull().references(() => recTeams.id),
  rank: integer("rank").notNull(),
  score: numeric("score").notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recGameProfiles = pgTable("rec_game_profiles", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  gameId: uuid("game_id"),
  teamId: uuid("team_id"),
  userId: uuid("user_id"),
  opponentTeamId: uuid("opponent_team_id"),
  won: boolean("won"),
  margin: integer("margin"),
  storyAngles: jsonb("story_angles").$type<Record<string, unknown> | null>(),
  qualifiedBadges: jsonb("qualified_badges").$type<Record<string, unknown> | null>(),
  profile: jsonb("profile").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recWatchedPlayers = pgTable("rec_watched_players", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  teamId: uuid("team_id").notNull(),
  playerName: text("player_name").notNull(),
  position: text("position").notNull(),
  classYear: text("class_year"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recGamePerformanceTags = pgTable("rec_game_performance_tags", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  gameId: uuid("game_id").notNull().references(() => recGames.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  teamId: uuid("team_id").notNull(),
  subjectType: text("subject_type").notNull(),
  watchedPlayerId: uuid("watched_player_id"),
  unit: text("unit"),
  statLines: jsonb("stat_lines").$type<Array<{ statKey: string; label: string; value: number }>>().notNull(),
  performanceGrade: text("performance_grade").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recGameStories = pgTable("rec_game_stories", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  gameId: uuid("game_id"),
  winnerTeamId: uuid("winner_team_id"),
  loserTeamId: uuid("loser_team_id"),
  primaryAngle: text("primary_angle"),
  headline: text("headline"),
  body: text("body"),
  storyType: text("story_type").notNull().default("game_article"),
  roundtable: jsonb("roundtable").$type<Array<{ speaker: string; role: string; take: string }> | null>(),
  publishedByDiscordId: text("published_by_discord_id"),
  notes: jsonb("notes").$type<Record<string, unknown> | null>(),
  postedMessageId: text("posted_message_id"),
  postedChannelId: text("posted_channel_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recStoryComments = pgTable("rec_story_comments", {
  id: uuid("id").primaryKey(),
  storyId: uuid("story_id").notNull().references(() => recGameStories.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recStoryReactions = pgTable("rec_story_reactions", {
  id: uuid("id").primaryKey(),
  storyId: uuid("story_id").notNull().references(() => recGameStories.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  reactionKey: text("reaction_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => ({ storyUserKey: uniqueIndex("rec_story_reactions_story_user_key").on(table.storyId, table.userId) }));

export const recGameReactions = pgTable("rec_game_reactions", {
  id: uuid("id").primaryKey(),
  gameId: uuid("game_id").notNull().references(() => recGames.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => recUsers.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  reactionKey: text("reaction_key").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => ({
  gameUserReactionKey: uniqueIndex("rec_game_reactions_game_user_reaction_key").on(table.gameId, table.userId, table.reactionKey),
  gameUserStandardReactionKey: uniqueIndex("rec_game_reactions_game_user_standard_key")
    .on(table.gameId, table.userId)
    .where(sql`${table.reactionKey} in ('love', 'like', 'dislike', 'poop')`),
}));

export const recBadgeOwnership = pgTable("rec_badge_ownership", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  userId: uuid("user_id").notNull(),
  teamId: uuid("team_id"),
  badgeKey: text("badge_key").notNull(),
  badgeScope: text("badge_scope").notNull(), // "game" | "season" | "career"
  polarity: text("polarity").notNull().default("positive"), // "positive" | "negative"
  tier: text("tier").notNull().default("normal"),
  season: integer("season"),
  week: integer("week"),
  earnedCount: integer("earned_count").notNull().default(1),
  lastEarnedWeek: integer("last_earned_week"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recBadgeEvents = pgTable("rec_badge_events", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull(),
  userId: uuid("user_id").notNull(),
  teamId: uuid("team_id"),
  badgeKey: text("badge_key").notNull(),
  badgeScope: text("badge_scope").notNull(),
  tier: text("tier"),
  season: integer("season"),
  week: integer("week"),
  gameId: uuid("game_id"),
  reason: text("reason"),
  statsSnapshot: jsonb("stats_snapshot").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

// ============================================================================
// Weekly score reviews / advance DM runs / trophies / championship credits
// ============================================================================

export const recWeeklyScoreReviews = pgTable("rec_weekly_score_reviews", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  guildId: text("guild_id"),
  imageUrl: text("image_url"),
  games: jsonb("games").$type<Record<string, unknown> | null>(),
  status: text("status").notNull().default("pending"),
  createdByDiscordId: text("created_by_discord_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recAdvanceDmRuns = pgTable("rec_advance_dm_runs", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  fromWeek: integer("from_week").notNull(),
  toWeek: integer("to_week").notNull(),
  advancedByDiscordId: text("advanced_by_discord_id"),
  advancedAt: timestamp("advanced_at", { withTimezone: true, mode: "string" }).notNull(),
  badgeState: jsonb("badge_state").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recUserSeasonBadgeTrophies = pgTable("rec_user_season_badge_trophies", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  userId: uuid("user_id").notNull(),
  badgeKey: text("badge_key").notNull(),
  tier: text("tier").notNull().default("normal"),
  seasonNumber: integer("season_number").notNull(),
  badgeLabel: text("badge_label"),
  badgeDescription: text("badge_description"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recManualChampionshipCredits = pgTable("rec_manual_championship_credits", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => recUsers.id),
  game: text("game"),
  championshipCount: integer("championship_count").notNull().default(1),
  sourceKey: text("source_key").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

// ============================================================================
// Wagers / legend catalog
// ============================================================================

export const recWagers = pgTable("rec_wagers", {
  id: uuid("id").primaryKey(),
  leagueId: uuid("league_id").notNull().references(() => recLeagues.id),
  seasonNumber: integer("season_number").notNull(),
  weekNumber: integer("week_number").notNull(),
  gameId: uuid("game_id"),
  placedByUserId: uuid("placed_by_user_id").notNull(),
  placedByDiscordId: text("placed_by_discord_id"),
  wagerKind: text("wager_kind").notNull().default("house"),
  counterpartyUserId: uuid("counterparty_user_id"),
  acceptedByUserId: uuid("accepted_by_user_id"),
  acceptedByDiscordId: text("accepted_by_discord_id"),
  challengeType: text("challenge_type"),
  market: text("market").notNull(),
  pick: text("pick").notNull(),
  line: numeric("line"),
  odds: numeric("odds").notNull().default("1"),
  stake: integer("stake").notNull(),
  potentialPayout: integer("potential_payout").notNull().default(0),
  status: text("status").notNull().default("pending"),
  isParlay: boolean("is_parlay").notNull().default(false),
  holdLedgerId: uuid("hold_ledger_id"),
  payoutLedgerId: uuid("payout_ledger_id"),
  pendingChannelId: text("pending_channel_id"),
  pendingMessageId: text("pending_message_id"),
  announcementChannelId: text("announcement_channel_id"),
  announcementMessageId: text("announcement_message_id"),
  settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  counteredFromWagerId: uuid("countered_from_wager_id")
});

export const recWagerLegs = pgTable("rec_wager_legs", {
  id: uuid("id").primaryKey(),
  wagerId: uuid("wager_id").notNull().references(() => recWagers.id),
  gameId: uuid("game_id"),
  market: text("market").notNull(),
  pick: text("pick").notNull(),
  line: numeric("line"),
  odds: numeric("odds").notNull().default("1"),
  legResult: text("leg_result"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull()
});

export const recLegendCatalog = pgTable("rec_legend_catalog", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  position: text("position").notNull(),
  positionGroup: text("position_group").notNull(),
  estOvr: numeric("est_ovr").notNull(),
  height: text("height"),
  weight: integer("weight"),
  hand: text("hand"),
  jerseyNumber: integer("jersey_number"),
  devTrait: text("dev_trait"),
  archetype: text("archetype"),
  buildNote: text("build_note"),
  attributes: jsonb("attributes").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  gameScope: text("game_scope").notNull().default("madden"),
  college: text("college")
});

export type RecCpuTeamSeasonStats = typeof recCpuTeamSeasonStats.$inferSelect;
export type RecGlobalUserGameRecord = typeof recGlobalUserGameRecords.$inferSelect;
export type RecHighlightPayoutReview = typeof recHighlightPayoutReviews.$inferSelect;
export type RecPowerRankingSnapshot = typeof recPowerRankingSnapshots.$inferSelect;
export type RecGameProfile = typeof recGameProfiles.$inferSelect;
export type RecGameStory = typeof recGameStories.$inferSelect;
export type RecBadgeOwnership = typeof recBadgeOwnership.$inferSelect;
export type RecBadgeEvent = typeof recBadgeEvents.$inferSelect;
export type RecWeeklyScoreReview = typeof recWeeklyScoreReviews.$inferSelect;
export type RecAdvanceDmRun = typeof recAdvanceDmRuns.$inferSelect;
export type RecUserSeasonBadgeTrophy = typeof recUserSeasonBadgeTrophies.$inferSelect;
export type RecManualChampionshipCredit = typeof recManualChampionshipCredits.$inferSelect;
export type RecWager = typeof recWagers.$inferSelect;
export type RecWagerLeg = typeof recWagerLegs.$inferSelect;
export type RecLegendCatalog = typeof recLegendCatalog.$inferSelect;

// ============================================================================
// Relations — one() sides for every confirmed FK, plus many() reverse sides
// on the most central hub tables (recUsers, recLeagues, recTeams, recDiscordServers).
// ============================================================================

export const recUsersRelations = relations(recUsers, ({ many }) => ({
  discordAccounts: many(recDiscordAccounts),
  appAccounts: many(recAppAccounts),
  leagueMemberships: many(recLeagueMemberships),
  teamAssignments: many(recTeamAssignments)
}));

export const recLeaguesRelations = relations(recLeagues, ({ many }) => ({
  serverLinks: many(recServerLeagueLinks),
  seasons: many(recSeasons),
  teams: many(recTeams),
  games: many(recGames),
  gameResults: many(recGameResults),
  memberships: many(recLeagueMemberships)
}));

export const recDiscordServersRelations = relations(recDiscordServers, ({ many }) => ({
  leagueLinks: many(recServerLeagueLinks),
  routes: many(recServerRoutes),
  adminRoles: many(recServerAdminRoles)
}));

export const recTeamsRelations = relations(recTeams, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recTeams.leagueId], references: [recLeagues.id] }),
  players: many(recPlayers),
  rosterSnapshots: many(recRosterSnapshots)
}));

export const recDiscordAccountsRelations = relations(recDiscordAccounts, ({ one }) => ({
  user: one(recUsers, { fields: [recDiscordAccounts.userId], references: [recUsers.id] })
}));

export const recAppAccountsRelations = relations(recAppAccounts, ({ one }) => ({
  user: one(recUsers, { fields: [recAppAccounts.userId], references: [recUsers.id] })
}));

export const recServerLeagueLinksRelations = relations(recServerLeagueLinks, ({ one }) => ({
  server: one(recDiscordServers, { fields: [recServerLeagueLinks.serverId], references: [recDiscordServers.id] }),
  league: one(recLeagues, { fields: [recServerLeagueLinks.leagueId], references: [recLeagues.id] })
}));

export const recSeasonsRelations = relations(recSeasons, ({ one }) => ({
  league: one(recLeagues, { fields: [recSeasons.leagueId], references: [recLeagues.id] })
}));

export const recMaddenSourceLinksRelations = relations(recMaddenSourceLinks, ({ one }) => ({
  league: one(recLeagues, { fields: [recMaddenSourceLinks.leagueId], references: [recLeagues.id] }),
  connectedByUser: one(recUsers, { fields: [recMaddenSourceLinks.connectedByUserId], references: [recUsers.id] })
}));

export const recServerRoutesRelations = relations(recServerRoutes, ({ one }) => ({
  server: one(recDiscordServers, { fields: [recServerRoutes.serverId], references: [recDiscordServers.id] })
}));

export const recServerAdminRolesRelations = relations(recServerAdminRoles, ({ one }) => ({
  server: one(recDiscordServers, { fields: [recServerAdminRoles.serverId], references: [recDiscordServers.id] })
}));

export const recLeagueMembershipsRelations = relations(recLeagueMemberships, ({ one }) => ({
  league: one(recLeagues, { fields: [recLeagueMemberships.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recLeagueMemberships.userId], references: [recUsers.id] })
}));

export const recTeamAssignmentsRelations = relations(recTeamAssignments, ({ one }) => ({
  league: one(recLeagues, { fields: [recTeamAssignments.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recTeamAssignments.teamId], references: [recTeams.id] }),
  user: one(recUsers, { fields: [recTeamAssignments.userId], references: [recUsers.id] })
}));

export const recAccountReconciliationQueueRelations = relations(recAccountReconciliationQueue, ({ one }) => ({
  league: one(recLeagues, { fields: [recAccountReconciliationQueue.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recAccountReconciliationQueue.teamId], references: [recTeams.id] }),
  possibleUser: one(recUsers, { fields: [recAccountReconciliationQueue.possibleUserId], references: [recUsers.id] }),
  resolvedByUser: one(recUsers, { fields: [recAccountReconciliationQueue.resolvedByUserId], references: [recUsers.id] })
}));

export const recGlobalUserRecordsRelations = relations(recGlobalUserRecords, ({ one }) => ({
  user: one(recUsers, { fields: [recGlobalUserRecords.userId], references: [recUsers.id] })
}));

export const recLeagueUserRecordsRelations = relations(recLeagueUserRecords, ({ one }) => ({
  league: one(recLeagues, { fields: [recLeagueUserRecords.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recLeagueUserRecords.userId], references: [recUsers.id] })
}));

export const recSeasonUserRecordsRelations = relations(recSeasonUserRecords, ({ one }) => ({
  season: one(recSeasons, { fields: [recSeasonUserRecords.seasonId], references: [recSeasons.id] }),
  league: one(recLeagues, { fields: [recSeasonUserRecords.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recSeasonUserRecords.userId], references: [recUsers.id] })
}));

export const recLegacyUserBaselinesRelations = relations(recLegacyUserBaselines, ({ one }) => ({
  user: one(recUsers, { fields: [recLegacyUserBaselines.userId], references: [recUsers.id] }),
  migratedByUser: one(recUsers, { fields: [recLegacyUserBaselines.migratedByUserId], references: [recUsers.id] })
}));

export const recWalletsRelations = relations(recWallets, ({ one }) => ({
  user: one(recUsers, { fields: [recWallets.userId], references: [recUsers.id] })
}));

export const recDollarLedgerRelations = relations(recDollarLedger, ({ one }) => ({
  user: one(recUsers, { fields: [recDollarLedger.userId], references: [recUsers.id] }),
  league: one(recLeagues, { fields: [recDollarLedger.leagueId], references: [recLeagues.id] }),
  season: one(recSeasons, { fields: [recDollarLedger.seasonId], references: [recSeasons.id] }),
  createdByUser: one(recUsers, { fields: [recDollarLedger.createdByUserId], references: [recUsers.id] })
}));

export const recPurchasesRelations = relations(recPurchases, ({ one }) => ({
  user: one(recUsers, { fields: [recPurchases.userId], references: [recUsers.id] }),
  league: one(recLeagues, { fields: [recPurchases.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recPurchases.teamId], references: [recTeams.id] }),
  season: one(recSeasons, { fields: [recPurchases.seasonId], references: [recSeasons.id] })
}));

export const recPurchaseHoldsRelations = relations(recPurchaseHolds, ({ one }) => ({
  purchase: one(recPurchases, { fields: [recPurchaseHolds.purchaseId], references: [recPurchases.id] }),
  user: one(recUsers, { fields: [recPurchaseHolds.userId], references: [recUsers.id] }),
  league: one(recLeagues, { fields: [recPurchaseHolds.leagueId], references: [recLeagues.id] }),
  createdByUser: one(recUsers, { fields: [recPurchaseHolds.createdByUserId], references: [recUsers.id] })
}));

export const recGamesRelations = relations(recGames, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recGames.leagueId], references: [recLeagues.id] }),
  season: one(recSeasons, { fields: [recGames.seasonId], references: [recSeasons.id] }),
  homeTeam: one(recTeams, { fields: [recGames.homeTeamId], references: [recTeams.id], relationName: "recGamesHomeTeam" }),
  awayTeam: one(recTeams, { fields: [recGames.awayTeamId], references: [recTeams.id], relationName: "recGamesAwayTeam" }),
  homeUser: one(recUsers, { fields: [recGames.homeUserId], references: [recUsers.id], relationName: "recGamesHomeUser" }),
  awayUser: one(recUsers, { fields: [recGames.awayUserId], references: [recUsers.id], relationName: "recGamesAwayUser" }),
  schedulingEvents: many(recGameSchedulingEvents)
}));

export const recGameResultsRelations = relations(recGameResults, ({ one }) => ({
  league: one(recLeagues, { fields: [recGameResults.leagueId], references: [recLeagues.id] }),
  homeTeam: one(recTeams, { fields: [recGameResults.homeTeamId], references: [recTeams.id], relationName: "recGameResultsHomeTeam" }),
  awayTeam: one(recTeams, { fields: [recGameResults.awayTeamId], references: [recTeams.id], relationName: "recGameResultsAwayTeam" }),
  homeUser: one(recUsers, { fields: [recGameResults.homeUserId], references: [recUsers.id], relationName: "recGameResultsHomeUser" }),
  awayUser: one(recUsers, { fields: [recGameResults.awayUserId], references: [recUsers.id], relationName: "recGameResultsAwayUser" }),
  winningUser: one(recUsers, { fields: [recGameResults.winningUserId], references: [recUsers.id], relationName: "recGameResultsWinningUser" }),
  losingUser: one(recUsers, { fields: [recGameResults.losingUserId], references: [recUsers.id], relationName: "recGameResultsLosingUser" }),
  winningTeam: one(recTeams, { fields: [recGameResults.winningTeamId], references: [recTeams.id], relationName: "recGameResultsWinningTeam" }),
  losingTeam: one(recTeams, { fields: [recGameResults.losingTeamId], references: [recTeams.id], relationName: "recGameResultsLosingTeam" })
}));

export const recGameSchedulingEventsRelations = relations(recGameSchedulingEvents, ({ one }) => ({
  game: one(recGames, { fields: [recGameSchedulingEvents.gameId], references: [recGames.id] }),
  user: one(recUsers, { fields: [recGameSchedulingEvents.userId], references: [recUsers.id] })
}));

export const recDraftPicksRelations = relations(recDraftPicks, ({ one }) => ({
  league: one(recLeagues, { fields: [recDraftPicks.leagueId], references: [recLeagues.id] }),
  season: one(recSeasons, { fields: [recDraftPicks.seasonId], references: [recSeasons.id] }),
  originalTeam: one(recTeams, { fields: [recDraftPicks.originalTeamId], references: [recTeams.id], relationName: "recDraftPicksOriginalTeam" }),
  currentTeam: one(recTeams, { fields: [recDraftPicks.currentTeamId], references: [recTeams.id], relationName: "recDraftPicksCurrentTeam" }),
  createdByUser: one(recUsers, { fields: [recDraftPicks.createdByUserId], references: [recUsers.id] })
}));

export const recDraftPickAuditRelations = relations(recDraftPickAudit, ({ one }) => ({
  draftPick: one(recDraftPicks, { fields: [recDraftPickAudit.draftPickId], references: [recDraftPicks.id] }),
  changedByUser: one(recUsers, { fields: [recDraftPickAudit.changedByUserId], references: [recUsers.id] })
}));

export const recMediaSubmissionsRelations = relations(recMediaSubmissions, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recMediaSubmissions.leagueId], references: [recLeagues.id] }),
  season: one(recSeasons, { fields: [recMediaSubmissions.seasonId], references: [recSeasons.id] }),
  submittedByUser: one(recUsers, { fields: [recMediaSubmissions.submittedByUserId], references: [recUsers.id] }),
  votes: many(recMediaVotes)
}));

export const recMediaVotesRelations = relations(recMediaVotes, ({ one }) => ({
  submission: one(recMediaSubmissions, { fields: [recMediaVotes.submissionId], references: [recMediaSubmissions.id] }),
  voterUser: one(recUsers, { fields: [recMediaVotes.voterUserId], references: [recUsers.id] })
}));

export const recMediaAwardsRelations = relations(recMediaAwards, ({ one }) => ({
  league: one(recLeagues, { fields: [recMediaAwards.leagueId], references: [recLeagues.id] }),
  season: one(recSeasons, { fields: [recMediaAwards.seasonId], references: [recSeasons.id] }),
  winningSubmission: one(recMediaSubmissions, { fields: [recMediaAwards.winningSubmissionId], references: [recMediaSubmissions.id] }),
  winnerUser: one(recUsers, { fields: [recMediaAwards.winnerUserId], references: [recUsers.id] })
}));

export const recAuditLogsRelations = relations(recAuditLogs, ({ one }) => ({
  actorUser: one(recUsers, { fields: [recAuditLogs.actorUserId], references: [recUsers.id] })
}));

export const recLeagueFeatureSettingsRelations = relations(recLeagueFeatureSettings, ({ one }) => ({
  league: one(recLeagues, { fields: [recLeagueFeatureSettings.leagueId], references: [recLeagues.id] })
}));

export const recLeagueConfigurationRelations = relations(recLeagueConfiguration, ({ one }) => ({
  league: one(recLeagues, { fields: [recLeagueConfiguration.leagueId], references: [recLeagues.id] })
}));

export const recUserHeadToHeadRecordsRelations = relations(recUserHeadToHeadRecords, ({ one }) => ({
  userA: one(recUsers, { fields: [recUserHeadToHeadRecords.userAId], references: [recUsers.id], relationName: "recUserHeadToHeadRecordsUserA" }),
  userB: one(recUsers, { fields: [recUserHeadToHeadRecords.userBId], references: [recUsers.id], relationName: "recUserHeadToHeadRecordsUserB" }),
  lastGame: one(recGames, { fields: [recUserHeadToHeadRecords.lastGameId], references: [recGames.id] })
}));

export const recUserRecordsRelations = relations(recUserRecords, ({ one }) => ({
  user: one(recUsers, { fields: [recUserRecords.userId], references: [recUsers.id] }),
  lastGame: one(recGameResults, { fields: [recUserRecords.lastGameId], references: [recGameResults.id] })
}));

export const recEosPayoutBatchesRelations = relations(recEosPayoutBatches, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recEosPayoutBatches.leagueId], references: [recLeagues.id] }),
  createdByUser: one(recUsers, { fields: [recEosPayoutBatches.createdByUserId], references: [recUsers.id], relationName: "recEosPayoutBatchesCreatedByUser" }),
  clearedByUser: one(recUsers, { fields: [recEosPayoutBatches.clearedByUserId], references: [recUsers.id], relationName: "recEosPayoutBatchesClearedByUser" }),
  items: many(recEosPayoutItems)
}));

export const recEosPayoutItemsRelations = relations(recEosPayoutItems, ({ one }) => ({
  batch: one(recEosPayoutBatches, { fields: [recEosPayoutItems.batchId], references: [recEosPayoutBatches.id] }),
  league: one(recLeagues, { fields: [recEosPayoutItems.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recEosPayoutItems.userId], references: [recUsers.id], relationName: "recEosPayoutItemsUser" }),
  team: one(recTeams, { fields: [recEosPayoutItems.teamId], references: [recTeams.id] }),
  approvedByUser: one(recUsers, { fields: [recEosPayoutItems.approvedByUserId], references: [recUsers.id], relationName: "recEosPayoutItemsApprovedByUser" }),
  deniedByUser: one(recUsers, { fields: [recEosPayoutItems.deniedByUserId], references: [recUsers.id], relationName: "recEosPayoutItemsDeniedByUser" }),
  commissionerUser: one(recUsers, { fields: [recEosPayoutItems.commissionerUserId], references: [recUsers.id], relationName: "recEosPayoutItemsCommissionerUser" }),
  issuedLedger: one(recDollarLedger, { fields: [recEosPayoutItems.issuedLedgerId], references: [recDollarLedger.id] })
}));

export const recWeeklyChallengesRelations = relations(recWeeklyChallenges, ({ one }) => ({
  league: one(recLeagues, { fields: [recWeeklyChallenges.leagueId], references: [recLeagues.id] }),
  game: one(recGames, { fields: [recWeeklyChallenges.gameId], references: [recGames.id] }),
  user: one(recUsers, { fields: [recWeeklyChallenges.userId], references: [recUsers.id], relationName: "recWeeklyChallengesUser" }),
  team: one(recTeams, { fields: [recWeeklyChallenges.teamId], references: [recTeams.id], relationName: "recWeeklyChallengesTeam" }),
  opponentTeam: one(recTeams, { fields: [recWeeklyChallenges.opponentTeamId], references: [recTeams.id], relationName: "recWeeklyChallengesOpponentTeam" }),
  opponentUser: one(recUsers, { fields: [recWeeklyChallenges.opponentUserId], references: [recUsers.id], relationName: "recWeeklyChallengesOpponentUser" }),
  paidLedger: one(recDollarLedger, { fields: [recWeeklyChallenges.paidLedgerId], references: [recDollarLedger.id] })
}));

export const recGameChannelsRelations = relations(recGameChannels, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recGameChannels.leagueId], references: [recLeagues.id] }),
  game: one(recGames, { fields: [recGameChannels.gameId], references: [recGames.id] }),
  awayTeam: one(recTeams, { fields: [recGameChannels.awayTeamId], references: [recTeams.id], relationName: "recGameChannelsAwayTeam" }),
  homeTeam: one(recTeams, { fields: [recGameChannels.homeTeamId], references: [recTeams.id], relationName: "recGameChannelsHomeTeam" }),
  awayUser: one(recUsers, { fields: [recGameChannels.awayUserId], references: [recUsers.id], relationName: "recGameChannelsAwayUser" }),
  homeUser: one(recUsers, { fields: [recGameChannels.homeUserId], references: [recUsers.id], relationName: "recGameChannelsHomeUser" }),
  checkins: many(recGameChannelCheckins),
  reminders: many(recGameChannelReminders)
}));

export const recGameChannelCheckinsRelations = relations(recGameChannelCheckins, ({ one }) => ({
  gameChannel: one(recGameChannels, { fields: [recGameChannelCheckins.gameChannelId], references: [recGameChannels.id] }),
  league: one(recLeagues, { fields: [recGameChannelCheckins.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recGameChannelCheckins.userId], references: [recUsers.id] })
}));

export const recGameChannelRemindersRelations = relations(recGameChannelReminders, ({ one }) => ({
  gameChannel: one(recGameChannels, { fields: [recGameChannelReminders.gameChannelId], references: [recGameChannels.id] }),
  targetUser: one(recUsers, { fields: [recGameChannelReminders.targetUserId], references: [recUsers.id] })
}));

export const recWeeklyPlayerAwardsRelations = relations(recWeeklyPlayerAwards, ({ one }) => ({
  league: one(recLeagues, { fields: [recWeeklyPlayerAwards.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recWeeklyPlayerAwards.teamId], references: [recTeams.id] }),
  user: one(recUsers, { fields: [recWeeklyPlayerAwards.userId], references: [recUsers.id] }),
  paidLedger: one(recDollarLedger, { fields: [recWeeklyPlayerAwards.paidLedgerId], references: [recDollarLedger.id] })
}));

export const recGameOfWeekCandidatesRelations = relations(recGameOfWeekCandidates, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recGameOfWeekCandidates.leagueId], references: [recLeagues.id] }),
  game: one(recGames, { fields: [recGameOfWeekCandidates.gameId], references: [recGames.id] }),
  awayTeam: one(recTeams, { fields: [recGameOfWeekCandidates.awayTeamId], references: [recTeams.id], relationName: "recGameOfWeekCandidatesAwayTeam" }),
  homeTeam: one(recTeams, { fields: [recGameOfWeekCandidates.homeTeamId], references: [recTeams.id], relationName: "recGameOfWeekCandidatesHomeTeam" }),
  awayUser: one(recUsers, { fields: [recGameOfWeekCandidates.awayUserId], references: [recUsers.id], relationName: "recGameOfWeekCandidatesAwayUser" }),
  homeUser: one(recUsers, { fields: [recGameOfWeekCandidates.homeUserId], references: [recUsers.id], relationName: "recGameOfWeekCandidatesHomeUser" }),
  polls: many(recGameOfWeekPolls)
}));

export const recGameOfWeekPollsRelations = relations(recGameOfWeekPolls, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recGameOfWeekPolls.leagueId], references: [recLeagues.id] }),
  game: one(recGames, { fields: [recGameOfWeekPolls.gameId], references: [recGames.id] }),
  candidate: one(recGameOfWeekCandidates, { fields: [recGameOfWeekPolls.candidateId], references: [recGameOfWeekCandidates.id] }),
  awayTeam: one(recTeams, { fields: [recGameOfWeekPolls.awayTeamId], references: [recTeams.id], relationName: "recGameOfWeekPollsAwayTeam" }),
  homeTeam: one(recTeams, { fields: [recGameOfWeekPolls.homeTeamId], references: [recTeams.id], relationName: "recGameOfWeekPollsHomeTeam" }),
  winningTeam: one(recTeams, { fields: [recGameOfWeekPolls.winningTeamId], references: [recTeams.id], relationName: "recGameOfWeekPollsWinningTeam" }),
  awayUser: one(recUsers, { fields: [recGameOfWeekPolls.awayUserId], references: [recUsers.id], relationName: "recGameOfWeekPollsAwayUser" }),
  homeUser: one(recUsers, { fields: [recGameOfWeekPolls.homeUserId], references: [recUsers.id], relationName: "recGameOfWeekPollsHomeUser" }),
  votes: many(recGameOfWeekVotes)
}));

export const recGameOfWeekVotesRelations = relations(recGameOfWeekVotes, ({ one }) => ({
  poll: one(recGameOfWeekPolls, { fields: [recGameOfWeekVotes.pollId], references: [recGameOfWeekPolls.id] }),
  league: one(recLeagues, { fields: [recGameOfWeekVotes.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recGameOfWeekVotes.userId], references: [recUsers.id] }),
  selectedTeam: one(recTeams, { fields: [recGameOfWeekVotes.selectedTeamId], references: [recTeams.id] }),
  paidLedger: one(recDollarLedger, { fields: [recGameOfWeekVotes.paidLedgerId], references: [recDollarLedger.id] })
}));

export const recGlobalGotwGuessingRecordsRelations = relations(recGlobalGotwGuessingRecords, ({ one }) => ({
  user: one(recUsers, { fields: [recGlobalGotwGuessingRecords.userId], references: [recUsers.id] })
}));

export const recPlayersRelations = relations(recPlayers, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recPlayers.leagueId], references: [recLeagues.id] }),
  rosterSnapshots: many(recRosterSnapshots),
  weeklyStats: many(recPlayerWeeklyStats)
}));

export const recRosterSnapshotsRelations = relations(recRosterSnapshots, ({ one }) => ({
  league: one(recLeagues, { fields: [recRosterSnapshots.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recRosterSnapshots.teamId], references: [recTeams.id] }),
  player: one(recPlayers, { fields: [recRosterSnapshots.playerId], references: [recPlayers.id] })
}));

export const recPlayerWeeklyStatsRelations = relations(recPlayerWeeklyStats, ({ one }) => ({
  league: one(recLeagues, { fields: [recPlayerWeeklyStats.leagueId], references: [recLeagues.id] }),
  player: one(recPlayers, { fields: [recPlayerWeeklyStats.playerId], references: [recPlayers.id] }),
  team: one(recTeams, { fields: [recPlayerWeeklyStats.teamId], references: [recTeams.id] })
}));

export const recTeamWeeklyStatsRelations = relations(recTeamWeeklyStats, ({ one }) => ({
  league: one(recLeagues, { fields: [recTeamWeeklyStats.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recTeamWeeklyStats.teamId], references: [recTeams.id] })
}));

export const recUserH2hGlobalRecordsRelations = relations(recUserH2hGlobalRecords, ({ one }) => ({
  userA: one(recUsers, { fields: [recUserH2hGlobalRecords.userAId], references: [recUsers.id], relationName: "recUserH2hGlobalRecordsUserA" }),
  userB: one(recUsers, { fields: [recUserH2hGlobalRecords.userBId], references: [recUsers.id], relationName: "recUserH2hGlobalRecordsUserB" })
}));

export const recUserH2hLeagueRecordsRelations = relations(recUserH2hLeagueRecords, ({ one }) => ({
  league: one(recLeagues, { fields: [recUserH2hLeagueRecords.leagueId], references: [recLeagues.id] }),
  userA: one(recUsers, { fields: [recUserH2hLeagueRecords.userAId], references: [recUsers.id], relationName: "recUserH2hLeagueRecordsUserA" }),
  userB: one(recUsers, { fields: [recUserH2hLeagueRecords.userBId], references: [recUsers.id], relationName: "recUserH2hLeagueRecordsUserB" })
}));

export const recLeagueRecordsRelations = relations(recLeagueRecords, ({ one }) => ({
  league: one(recLeagues, { fields: [recLeagueRecords.leagueId], references: [recLeagues.id] }),
  recordHolder: one(recUsers, { fields: [recLeagueRecords.recordHolderId], references: [recUsers.id], relationName: "recLeagueRecordsRecordHolder" }),
  previousHolder: one(recUsers, { fields: [recLeagueRecords.previousHolderId], references: [recUsers.id], relationName: "recLeagueRecordsPreviousHolder" })
}));

export const recPowerRankingsRelations = relations(recPowerRankings, ({ one }) => ({
  league: one(recLeagues, { fields: [recPowerRankings.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recPowerRankings.teamId], references: [recTeams.id] })
}));

export const recEosAwardPollsRelations = relations(recEosAwardPolls, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recEosAwardPolls.leagueId], references: [recLeagues.id] }),
  winnerUser: one(recUsers, { fields: [recEosAwardPolls.winnerUserId], references: [recUsers.id] }),
  paidLedger: one(recDollarLedger, { fields: [recEosAwardPolls.paidLedgerId], references: [recDollarLedger.id] }),
  votes: many(recEosAwardVotes)
}));

export const recEosAwardVotesRelations = relations(recEosAwardVotes, ({ one }) => ({
  poll: one(recEosAwardPolls, { fields: [recEosAwardVotes.pollId], references: [recEosAwardPolls.id] }),
  voterUser: one(recUsers, { fields: [recEosAwardVotes.voterUserId], references: [recUsers.id], relationName: "recEosAwardVotesVoterUser" }),
  nomineeUser: one(recUsers, { fields: [recEosAwardVotes.nomineeUserId], references: [recUsers.id], relationName: "recEosAwardVotesNomineeUser" })
}));

export const recHighlightPostsRelations = relations(recHighlightPosts, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recHighlightPosts.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recHighlightPosts.userId], references: [recUsers.id] }),
  team: one(recTeams, { fields: [recHighlightPosts.teamId], references: [recTeams.id] }),
  payoutReviews: many(recHighlightPayoutReviews)
}));

export const recPotyNominationsRelations = relations(recPotyNominations, ({ one }) => ({
  league: one(recLeagues, { fields: [recPotyNominations.leagueId], references: [recLeagues.id] }),
  nominatorUser: one(recUsers, { fields: [recPotyNominations.nominatorUserId], references: [recUsers.id], relationName: "recPotyNominationsNominatorUser" }),
  nomineeUser: one(recUsers, { fields: [recPotyNominations.nomineeUserId], references: [recUsers.id], relationName: "recPotyNominationsNomineeUser" })
}));

export const recGotyNominationsRelations = relations(recGotyNominations, ({ one }) => ({
  league: one(recLeagues, { fields: [recGotyNominations.leagueId], references: [recLeagues.id] }),
  nominatorUser: one(recUsers, { fields: [recGotyNominations.nominatorUserId], references: [recUsers.id] }),
  nominatedGame: one(recGameResults, { fields: [recGotyNominations.nominatedGameId], references: [recGameResults.id] })
}));

export const recDevUpgradePrizesRelations = relations(recDevUpgradePrizes, ({ one }) => ({
  league: one(recLeagues, { fields: [recDevUpgradePrizes.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recDevUpgradePrizes.userId], references: [recUsers.id] }),
  team: one(recTeams, { fields: [recDevUpgradePrizes.teamId], references: [recTeams.id] })
}));

export const recAwardsRelations = relations(recAwards, ({ many }) => ({
  nominees: many(recAwardNominees),
  votes: many(recAwardVotes)
}));

export const recAwardNomineesRelations = relations(recAwardNominees, ({ one }) => ({
  award: one(recAwards, { fields: [recAwardNominees.awardId], references: [recAwards.id] }),
  player: one(recPlayers, { fields: [recAwardNominees.playerId], references: [recPlayers.id] }),
  team: one(recTeams, { fields: [recAwardNominees.teamId], references: [recTeams.id] })
}));

export const recAwardVotesRelations = relations(recAwardVotes, ({ one }) => ({
  award: one(recAwards, { fields: [recAwardVotes.awardId], references: [recAwards.id] })
}));

export const recSeasonTeamSeedsRelations = relations(recSeasonTeamSeeds, ({ one }) => ({
  league: one(recLeagues, { fields: [recSeasonTeamSeeds.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recSeasonTeamSeeds.teamId], references: [recTeams.id] })
}));

export const recActiveCheckEventsRelations = relations(recActiveCheckEvents, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recActiveCheckEvents.leagueId], references: [recLeagues.id] }),
  responses: many(recActiveCheckResponses),
  misses: many(recActiveCheckMisses)
}));

export const recActiveCheckResponsesRelations = relations(recActiveCheckResponses, ({ one }) => ({
  event: one(recActiveCheckEvents, { fields: [recActiveCheckResponses.eventId], references: [recActiveCheckEvents.id] })
}));

export const recActiveCheckMissesRelations = relations(recActiveCheckMisses, ({ one }) => ({
  event: one(recActiveCheckEvents, { fields: [recActiveCheckMisses.eventId], references: [recActiveCheckEvents.id] })
}));

export const recStreamComplianceLogsRelations = relations(recStreamComplianceLogs, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recStreamComplianceLogs.leagueId], references: [recLeagues.id] }),
  game: one(recGames, { fields: [recStreamComplianceLogs.gameId], references: [recGames.id] }),
  user: one(recUsers, { fields: [recStreamComplianceLogs.userId], references: [recUsers.id] }),
  team: one(recTeams, { fields: [recStreamComplianceLogs.teamId], references: [recTeams.id] }),
  payoutReviews: many(recStreamPayoutReviews)
}));

export const recGameChannelActivityPenaltiesRelations = relations(recGameChannelActivityPenalties, ({ one }) => ({
  gameChannel: one(recGameChannels, { fields: [recGameChannelActivityPenalties.gameChannelId], references: [recGameChannels.id] }),
  league: one(recLeagues, { fields: [recGameChannelActivityPenalties.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recGameChannelActivityPenalties.userId], references: [recUsers.id] })
}));

export const recRuleSectionsRelations = relations(recRuleSections, ({ one }) => ({
  league: one(recLeagues, { fields: [recRuleSections.leagueId], references: [recLeagues.id] })
}));

export const recStreamPayoutReviewsRelations = relations(recStreamPayoutReviews, ({ one }) => ({
  streamLog: one(recStreamComplianceLogs, { fields: [recStreamPayoutReviews.streamLogId], references: [recStreamComplianceLogs.id] }),
  league: one(recLeagues, { fields: [recStreamPayoutReviews.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recStreamPayoutReviews.userId], references: [recUsers.id] }),
  team: one(recTeams, { fields: [recStreamPayoutReviews.teamId], references: [recTeams.id] }),
  issuedLedger: one(recDollarLedger, { fields: [recStreamPayoutReviews.issuedLedgerId], references: [recDollarLedger.id] })
}));

export const recCommissionersInboxRelations = relations(recCommissionersInbox, ({ one }) => ({
  server: one(recDiscordServers, { fields: [recCommissionersInbox.serverId], references: [recDiscordServers.id] }),
  league: one(recLeagues, { fields: [recCommissionersInbox.leagueId], references: [recLeagues.id] }),
  requesterUser: one(recUsers, { fields: [recCommissionersInbox.requesterUserId], references: [recUsers.id], relationName: "recCommissionersInboxRequesterUser" }),
  targetUser: one(recUsers, { fields: [recCommissionersInbox.targetUserId], references: [recUsers.id], relationName: "recCommissionersInboxTargetUser" }),
  reviewedByUser: one(recUsers, { fields: [recCommissionersInbox.reviewedByUserId], references: [recUsers.id], relationName: "recCommissionersInboxReviewedByUser" }),
  team: one(recTeams, { fields: [recCommissionersInbox.teamId], references: [recTeams.id] })
}));

export const recTeamStandingsSnapshotsRelations = relations(recTeamStandingsSnapshots, ({ one }) => ({
  league: one(recLeagues, { fields: [recTeamStandingsSnapshots.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recTeamStandingsSnapshots.teamId], references: [recTeams.id] })
}));

export const recBoxScoreSubmissionsRelations = relations(recBoxScoreSubmissions, ({ one }) => ({
  league: one(recLeagues, { fields: [recBoxScoreSubmissions.leagueId], references: [recLeagues.id] }),
  submittedByUser: one(recUsers, { fields: [recBoxScoreSubmissions.submittedByUserId], references: [recUsers.id], relationName: "recBoxScoreSubmissionsSubmittedByUser" }),
  homeTeam: one(recTeams, { fields: [recBoxScoreSubmissions.homeTeamId], references: [recTeams.id], relationName: "recBoxScoreSubmissionsHomeTeam" }),
  awayTeam: one(recTeams, { fields: [recBoxScoreSubmissions.awayTeamId], references: [recTeams.id], relationName: "recBoxScoreSubmissionsAwayTeam" }),
  homeUser: one(recUsers, { fields: [recBoxScoreSubmissions.homeUserId], references: [recUsers.id], relationName: "recBoxScoreSubmissionsHomeUser" }),
  awayUser: one(recUsers, { fields: [recBoxScoreSubmissions.awayUserId], references: [recUsers.id], relationName: "recBoxScoreSubmissionsAwayUser" }),
  game: one(recGames, { fields: [recBoxScoreSubmissions.gameId], references: [recGames.id] }),
  comebackWinnerTeam: one(recTeams, { fields: [recBoxScoreSubmissions.comebackWinnerTeamId], references: [recTeams.id], relationName: "recBoxScoreSubmissionsComebackWinnerTeam" })
}));

export const recUserBoxScoreProfileStatsRelations = relations(recUserBoxScoreProfileStats, ({ one }) => ({
  user: one(recUsers, { fields: [recUserBoxScoreProfileStats.userId], references: [recUsers.id] }),
  league: one(recLeagues, { fields: [recUserBoxScoreProfileStats.leagueId], references: [recLeagues.id] })
}));

export const recTeamLinkRequestsRelations = relations(recTeamLinkRequests, ({ one }) => ({
  league: one(recLeagues, { fields: [recTeamLinkRequests.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recTeamLinkRequests.teamId], references: [recTeams.id] }),
  requesterUser: one(recUsers, { fields: [recTeamLinkRequests.requesterUserId], references: [recUsers.id], relationName: "recTeamLinkRequestsRequesterUser" }),
  assignedByUser: one(recUsers, { fields: [recTeamLinkRequests.assignedByUserId], references: [recUsers.id], relationName: "recTeamLinkRequestsAssignedByUser" })
}));

export const recSeasonUserDisplayRecordsRelations = relations(recSeasonUserDisplayRecords, ({ one }) => ({
  league: one(recLeagues, { fields: [recSeasonUserDisplayRecords.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recSeasonUserDisplayRecords.userId], references: [recUsers.id] }),
  team: one(recTeams, { fields: [recSeasonUserDisplayRecords.teamId], references: [recTeams.id] })
}));

export const recCpuTeamSeasonStatsRelations = relations(recCpuTeamSeasonStats, ({ one }) => ({
  league: one(recLeagues, { fields: [recCpuTeamSeasonStats.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recCpuTeamSeasonStats.teamId], references: [recTeams.id] })
}));

export const recGlobalUserGameRecordsRelations = relations(recGlobalUserGameRecords, ({ one }) => ({
  user: one(recUsers, { fields: [recGlobalUserGameRecords.userId], references: [recUsers.id] })
}));

export const recHighlightPayoutReviewsRelations = relations(recHighlightPayoutReviews, ({ one }) => ({
  highlightPost: one(recHighlightPosts, { fields: [recHighlightPayoutReviews.highlightPostId], references: [recHighlightPosts.id] }),
  league: one(recLeagues, { fields: [recHighlightPayoutReviews.leagueId], references: [recLeagues.id] }),
  user: one(recUsers, { fields: [recHighlightPayoutReviews.userId], references: [recUsers.id] }),
  team: one(recTeams, { fields: [recHighlightPayoutReviews.teamId], references: [recTeams.id] }),
  issuedLedger: one(recDollarLedger, { fields: [recHighlightPayoutReviews.issuedLedgerId], references: [recDollarLedger.id] })
}));

export const recPowerRankingSnapshotsRelations = relations(recPowerRankingSnapshots, ({ one }) => ({
  league: one(recLeagues, { fields: [recPowerRankingSnapshots.leagueId], references: [recLeagues.id] }),
  team: one(recTeams, { fields: [recPowerRankingSnapshots.teamId], references: [recTeams.id] })
}));

export const recWeeklyScoreReviewsRelations = relations(recWeeklyScoreReviews, ({ one }) => ({
  league: one(recLeagues, { fields: [recWeeklyScoreReviews.leagueId], references: [recLeagues.id] })
}));

export const recAdvanceDmRunsRelations = relations(recAdvanceDmRuns, ({ one }) => ({
  league: one(recLeagues, { fields: [recAdvanceDmRuns.leagueId], references: [recLeagues.id] })
}));

export const recUserSeasonBadgeTrophiesRelations = relations(recUserSeasonBadgeTrophies, ({ one }) => ({
  league: one(recLeagues, { fields: [recUserSeasonBadgeTrophies.leagueId], references: [recLeagues.id] })
}));

export const recManualChampionshipCreditsRelations = relations(recManualChampionshipCredits, ({ one }) => ({
  user: one(recUsers, { fields: [recManualChampionshipCredits.userId], references: [recUsers.id] })
}));

export const recWagersRelations = relations(recWagers, ({ one, many }) => ({
  league: one(recLeagues, { fields: [recWagers.leagueId], references: [recLeagues.id] }),
  legs: many(recWagerLegs)
}));

export const recWagerLegsRelations = relations(recWagerLegs, ({ one }) => ({
  wager: one(recWagers, { fields: [recWagerLegs.wagerId], references: [recWagers.id] })
}));
