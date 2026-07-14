import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Guild, Message, MessageFlags, ModalBuilder, ModalSubmitInteraction, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { CFB_POSITIONS } from "@rec/shared";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { COLORS } from "../lib/colors.js";
import { recApi } from "../lib/rec-api.js";
import { getWeeklySubmissionsChannel, purgeChannelMessages } from "../lib/route-channels.js";

export const WEEKLY_SUBMISSIONS_CUSTOM_IDS = {
  boxScores: "rec:weekly_submissions:box_scores",
  playerStats: "rec:weekly_submissions:player_stats",
  recruiting: "rec:weekly_submissions:recruiting",
  statCategory: "rec:weekly_submissions:stat_category",
  statPlayer: "rec:weekly_submissions:stat_player",
  statModal: "rec:weekly_submissions:stat_modal",
  recruitPosition: "rec:weekly_submissions:recruit_position",
  recruitStars: "rec:weekly_submissions:recruit_stars",
  recruitHometown: "rec:weekly_submissions:recruit_hometown",
} as const;

type Session = { kind: "player" | "recruit"; guildId: string; channelId: string; userId: string; expiresAt: number; interaction: ButtonInteraction; name?: string; position?: string; stars?: number };
const sessions = new Map<string, Session>();
const key = (guildId: string, userId: string) => `${guildId}:${userId}`;
const STAT_FIELDS: Record<string, Array<[string, string]>> = {
  passing: [["completions","Completions"],["attempts","Attempts"],["yards","Passing yards"],["touchdowns","Passing touchdowns"],["interceptions","Interceptions"]],
  rushing: [["carries","Carries"],["yards","Rushing yards"],["touchdowns","Rushing touchdowns"],["fumbles","Fumbles"],["longest","Longest rush"]],
  receiving: [["receptions","Receptions"],["yards","Receiving yards"],["touchdowns","Receiving touchdowns"],["drops","Drops"],["longest","Longest reception"]],
  defense: [["tackles","Total tackles"],["tfl","Tackles for loss"],["sacks","Sacks"],["interceptions","Interceptions"],["forced_fumbles","Forced fumbles"]],
  kick_returns: [["returns","Kick returns"],["yards","Return yards"],["touchdowns","Return touchdowns"],["longest","Longest return"]],
  punt_returns: [["returns","Punt returns"],["yards","Return yards"],["touchdowns","Return touchdowns"],["longest","Longest return"]],
  kicking: [["fg_made","Field goals made"],["fg_attempted","Field goals attempted"],["longest","Longest field goal"],["xp_made","Extra points made"],["xp_attempted","Extra points attempted"]],
  punting: [["punts","Punts"],["yards","Punt yards"],["average","Average"],["inside_20","Inside the 20"],["touchbacks","Touchbacks"]],
};

const PLAYABLE_STAGES = new Set(["regular_season", "wild_card", "divisional", "conference_championship", "super_bowl", "cfp_first_round", "cfp_quarterfinals", "cfp_semifinals", "national_championship"]);

export async function publishWeeklySubmissionsPanel(guild: Guild) {
  const cfg = await recApi.getEconomyConfig(guild.id);
  const league = cfg.league ?? {};
  if (!PLAYABLE_STAGES.has(league.season_stage)) return { posted: false, reason: "not_playable" };
  const channel = await getWeeklySubmissionsChannel(guild, cfg.routes ?? {});
  if (!channel) return { posted: false, reason: "not_configured" };
  await purgeChannelMessages(channel);
  const stage = String(league.season_stage).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const week = league.current_week != null ? `Week ${league.current_week}` : stage;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.boxScores).setLabel("Box Scores").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.playerStats).setLabel("Player Stats").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.recruiting).setLabel("Recruiting Commits").setStyle(ButtonStyle.Success),
  );
  await channel.send({ embeds: [new EmbedBuilder().setTitle("REC Weekly Submissions").setColor(COLORS.gold).setDescription(`Season ${league.season_number ?? 1} • ${week}\n\nUse the buttons below. Submission messages are captured and removed so this panel stays in focus.`)], components: [row] });
  return { posted: true, channelId: channel.id };
}

function examplePath(name: string) {
  const candidates = [resolve(process.cwd(), "apps/bot/assets", name), resolve(process.cwd(), "apps/web/src/assets", name), resolve(process.cwd(), "assets", name)];
  return candidates.find(existsSync) ?? null;
}

export async function handleWeeklyBoxScores(interaction: ButtonInteraction) {
  const cfg = await recApi.getEconomyConfig(interaction.guildId!);
  const eligibility = await recApi.getBoxScoreUploadEligibility({ guildId: interaction.guildId!, discordId: interaction.user.id });
  if (!eligibility.hasScheduledGame) return interaction.reply({ content: `You do not have a scheduled game for Week ${eligibility.weekNumber}.`, flags: MessageFlags.Ephemeral });
  if (eligibility.existingSubmission) return interaction.reply({ content: eligibility.existingSubmission.submittedByDiscordId === interaction.user.id ? "Your game's box score is already pending or approved. A late second image can still be added while it is pending." : "Your opponent already submitted the shared H2H box score. Another submission is unnecessary, but you can still submit player stats for your team.", flags: MessageFlags.Ephemeral });
  const cfb = cfg.league?.game === "cfb_27";
  const description = cfb
    ? "Upload **two console screenshots** in this channel. Go to **CFB Tab > Team Schedule > Box Score** and press **X on PS5**.\n\n**Do NOT use the postgame box-score window shown immediately after the game. Do not use phone-camera photos.**"
    : "Upload **two in-game console screenshots** from the Madden box-score screens available when the game ends. Do not use phone-camera photos.";
  const files = cfb ? ["CFB Box Score Example 1.jpg", "CFB Box Score Example 2.jpg"].map(examplePath).filter((p): p is string => Boolean(p)).map((p) => new AttachmentBuilder(p)) : [];
  await interaction.reply({ embeds: [new EmbedBuilder().setTitle("Submit Box Scores").setColor(COLORS.gold).setDescription(description)], files, flags: MessageFlags.Ephemeral });
}

export async function handleWeeklyPlayerStats(interaction: ButtonInteraction) {
  const eligibility = await recApi.getBoxScoreUploadEligibility({ guildId: interaction.guildId!, discordId: interaction.user.id });
  if (!eligibility.hasScheduledGame) return interaction.reply({ content: "You do not have a current scheduled game (or this is a bye week).", flags: MessageFlags.Ephemeral });
  if (!eligibility.existingSubmission) return interaction.reply({ content: "Submit the game's box score first. A pending or approved submission from either H2H coach qualifies.", flags: MessageFlags.Ephemeral });
  sessions.set(key(interaction.guildId!, interaction.user.id), { kind: "player", guildId: interaction.guildId!, channelId: interaction.channelId, userId: interaction.user.id, expiresAt: Date.now() + 10 * 60_000, interaction });
  const { players } = await recApi.listMyWatchedPlayers({ guildId: interaction.guildId!, discordId: interaction.user.id });
  const description = "Choose a returning Player to Watch, or choose **Enter a new player** and type their first and last name in this channel. Typed messages are captured and deleted. After each stat line you can add another category for the same player or choose another player.";
  const select = new StringSelectMenuBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.statPlayer).setPlaceholder("Select a player").addOptions([
    { label: "Enter a new player", value: "__new__", description: "Type the player's first and last name" },
    ...players.slice(0, 24).map((player) => ({ label: player.playerName, value: player.id, description: player.position })),
  ]);
  return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Player Stats").setColor(COLORS.gold).setDescription(description)], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], flags: MessageFlags.Ephemeral });
}

function statCategoryRow() {
  const select = new StringSelectMenuBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.statCategory).setPlaceholder("Select a stat category").addOptions(Object.keys(STAT_FIELDS).map((category) => new StringSelectMenuOptionBuilder().setLabel(category.replace(/_/g," ").replace(/\b\w/g,(c)=>c.toUpperCase())).setValue(category)));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

export async function handleWeeklyRecruiting(interaction: ButtonInteraction) {
  const cfg = await recApi.getEconomyConfig(interaction.guildId!);
  if (cfg.league?.game !== "cfb_27") return interaction.reply({ content: "Recruiting commits are available only in College Football leagues.", flags: MessageFlags.Ephemeral });
  sessions.set(key(interaction.guildId!, interaction.user.id), { kind: "recruit", guildId: interaction.guildId!, channelId: interaction.channelId, userId: interaction.user.id, expiresAt: Date.now() + 10 * 60_000, interaction });
  return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Recruiting Commits").setColor(COLORS.gold).setDescription("Type the recruit's first and last name in this channel within 10 minutes. The message will be captured and deleted, then the private form continues.")], flags: MessageFlags.Ephemeral });
}

export async function handleWeeklySubmissionMessage(message: Message): Promise<boolean> {
  if (!message.guildId) return false; const session = sessions.get(key(message.guildId, message.author.id));
  if (!session || session.channelId !== message.channelId || session.expiresAt < Date.now()) return false;
  const name = message.content.trim().replace(/\s+/g, " "); if (!/^[\p{L}'-]+\s+[\p{L}' .-]+$/u.test(name) || name.length > 80) return false;
  session.name = name; await message.delete().catch(() => undefined);
  if (session.kind === "player") {
    await session.interaction.followUp({ content: `Adding stats for **${name}**.`, components: [statCategoryRow()], flags: MessageFlags.Ephemeral });
  } else {
    const select = new StringSelectMenuBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.recruitPosition).setPlaceholder("Select position").addOptions(CFB_POSITIONS.map((position) => ({ label: position, value: position })));
    await session.interaction.followUp({ content: `Recruit: **${name}**`, components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], flags: MessageFlags.Ephemeral });
  }
  return true;
}

export async function handleWeeklySubmissionSelect(interaction: StringSelectMenuInteraction) {
  const session = sessions.get(key(interaction.guildId!, interaction.user.id)); if (!session || session.expiresAt < Date.now()) return interaction.reply({ content: "This submission session expired. Start again from the weekly panel.", flags: MessageFlags.Ephemeral });
  if (interaction.customId === WEEKLY_SUBMISSIONS_CUSTOM_IDS.statPlayer) {
    const selected = interaction.values[0];
    if (selected === "__new__") return interaction.update({ content: "Type the player's first and last name in this channel within 10 minutes. Your message will be captured and deleted.", embeds: [], components: [] });
    const { players } = await recApi.listMyWatchedPlayers({ guildId: session.guildId, discordId: session.userId });
    const player = players.find((item) => item.id === selected);
    if (!player) return interaction.reply({ content: "That player is no longer available. Start again from the weekly panel.", flags: MessageFlags.Ephemeral });
    session.name = player.playerName;
    return interaction.update({ content: `Adding stats for **${player.playerName}**.`, embeds: [], components: [statCategoryRow()] });
  }
  if (interaction.customId === WEEKLY_SUBMISSIONS_CUSTOM_IDS.statCategory) {
    const category = interaction.values[0]; const fields = STAT_FIELDS[category];
    const modal = new ModalBuilder().setCustomId(`${WEEKLY_SUBMISSIONS_CUSTOM_IDS.statModal}:${category}`).setTitle(`${category.replace(/_/g," ")} stats`);
    modal.addComponents(...fields.map(([id,label]) => new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("0")))); return interaction.showModal(modal);
  }
  if (interaction.customId === WEEKLY_SUBMISSIONS_CUSTOM_IDS.recruitPosition) { session.position = interaction.values[0]; const select = new StringSelectMenuBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.recruitStars).setPlaceholder("Select star rating").addOptions([1,2,3,4,5].map((n)=>({label:`${n} Star${n===1?"":"s"}`,value:String(n)}))); return interaction.update({ content: `Recruit: **${session.name}** • ${session.position}`, components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] }); }
  if (interaction.customId === WEEKLY_SUBMISSIONS_CUSTOM_IDS.recruitStars) { session.stars = Number(interaction.values[0]); const modal = new ModalBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.recruitHometown).setTitle("Recruit hometown").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("city").setLabel("City").setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("state").setLabel("State").setStyle(TextInputStyle.Short).setRequired(true))); return interaction.showModal(modal); }
}

export async function handleWeeklySubmissionModal(interaction: ModalSubmitInteraction) {
  const session = sessions.get(key(interaction.guildId!, interaction.user.id)); if (!session?.name) return interaction.reply({ content:"Session expired.",flags:MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (interaction.customId.startsWith(`${WEEKLY_SUBMISSIONS_CUSTOM_IDS.statModal}:`)) { const category=interaction.customId.split(":").at(-1)!; const lines=STAT_FIELDS[category].flatMap(([statKey,label])=>{const raw=interaction.fields.getTextInputValue(statKey).trim(); if(!raw)return[]; const value=Number(raw); if(!Number.isFinite(value)||value<0)throw new Error(`${label} must be zero or a positive number.`); return[{statKey,label,value}];}); if(!lines.length)throw new Error("Enter at least one stat."); const obj=Object.fromEntries(lines.map(x=>[x.statKey,x.value])); if(obj.completions>obj.attempts)throw new Error("Completions cannot exceed attempts."); if(obj.fg_made>obj.fg_attempted||obj.xp_made>obj.xp_attempted)throw new Error("Made kicks cannot exceed attempts."); await recApi.submitPlayerStatLine({guildId:session.guildId,discordId:session.userId,playerName:session.name,category,statLines:lines}); return interaction.editReply({ content: `Saved ${category.replace(/_/g," ")} stats for **${session.name}**. Select another category to add another stat line, or return to the weekly panel when finished.`, components: [statCategoryRow()] }); }
    await recApi.submitRecruitCommit({guildId:session.guildId,discordId:session.userId,playerName:session.name,position:session.position!,starRating:session.stars!,homeCity:interaction.fields.getTextInputValue("city"),homeState:interaction.fields.getTextInputValue("state")}); sessions.delete(key(session.guildId,session.userId)); return interaction.editReply(`Saved **${session.name}** as a ${session.stars}-star ${session.position} commitment to your school.`);
  } catch(e){return interaction.editReply(e instanceof Error?e.message:String(e));}
}
