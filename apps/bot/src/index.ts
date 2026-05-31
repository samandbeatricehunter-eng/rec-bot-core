import { Client, EmbedBuilder, GatewayIntentBits, Interaction } from "discord.js";
import { env } from "./config/env.js";
import { recApi } from "./lib/rec-api.js";
import { isDiscordAdminInteraction } from "./lib/admin.js";
import { buildAdminPanelEmbed, buildAdminPanelRows, buildMainMenuEmbed, buildMainMenuRows, buildSetupDangerModal, MENU_CUSTOM_IDS, type SetupDangerAction } from "./ui/menu.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("clientReady", async () => {
  console.log(`REC Bot logged in as ${client.user?.tag ?? "unknown"}`);
  try { const health = await recApi.health(); console.log(`Connected to ${health.service}`); } catch (error) { console.error("REC Core API health check failed", error); }
});
client.on("interactionCreate", async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "menu") return await handleMenuCommand(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId === MENU_CUSTOM_IDS.mainSelect) return await handleMainMenuSelect(interaction);
    if (interaction.isButton()) {
      if (interaction.customId === MENU_CUSTOM_IDS.adminServerSetup) return await interaction.showModal(buildSetupDangerModal("server_setup"));
      if (interaction.customId === MENU_CUSTOM_IDS.adminLeagueSetup) return await interaction.showModal(buildSetupDangerModal("league_setup"));
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(MENU_CUSTOM_IDS.setupConfirmModal)) return await handleSetupConfirmationModal(interaction);
  } catch (error) {
    console.error("Interaction handling failed", error);
    if (interaction.isRepliable()) {
      const payload = { content:"REC Bot hit an error while handling that action.", ephemeral:true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => undefined);
      else await interaction.reply(payload).catch(() => undefined);
    }
  }
});
async function handleMenuCommand(interaction: Extract<Interaction,{isChatInputCommand():boolean}>) {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ ephemeral:true });
  const isAdmin = isDiscordAdminInteraction(interaction);
  let menuEmbed = buildMainMenuEmbed({ isAdmin });
  try {
    const baseline = await recApi.getBaseline(interaction.user.id);
    const record = baseline.globalRecord, wallet = baseline.wallet;
    menuEmbed = buildMainMenuEmbed({ displayName:baseline.user.display_name, recordText:`${record?.wins??0}-${record?.losses??0}-${record?.ties??0}`, playoffText:`${record?.playoff_wins??0}-${record?.playoff_losses??0}`, superbowlText:`${record?.superbowl_wins??0}-${record?.superbowl_losses??0}`, pointDifferential:record?.point_differential??0, wallet:wallet?.wallet_balance??0, savings:wallet?.savings_balance??0, isAdmin });
  } catch {}
  await interaction.editReply({ embeds:[menuEmbed], components:buildMainMenuRows(isAdmin) });
}
async function handleMainMenuSelect(interaction: Extract<Interaction,{isStringSelectMenu():boolean}>) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];
  if (selected === "admin_panel") {
    if (!isDiscordAdminInteraction(interaction)) return await interaction.reply({ content:"Only authorized admins can open the Admin Panel.", ephemeral:true });
    return await interaction.update({ embeds:[buildAdminPanelEmbed()], components:buildAdminPanelRows() });
  }
  const labels:Record<string,string> = { rosters:"Rosters", manage_team:"Manage My Team", standings_stats:"Standings & Stats", rec_bank:"REC Bank", media_center:"Media Center", help_rules:"Help / Rules" };
  await interaction.update({ embeds:[new EmbedBuilder().setTitle(labels[selected] ?? "REC League HQ").setDescription("This department shell is connected. The detailed workflow will be built next.").setFooter({ text:"REC Core connected" })], components:[] });
}
async function handleSetupConfirmationModal(interaction: Extract<Interaction,{isModalSubmit():boolean}>) {
  if (!interaction.isModalSubmit()) return;
  if (!isDiscordAdminInteraction(interaction)) return await interaction.reply({ content:"Only authorized admins can use setup workflows.", ephemeral:true });
  if (!interaction.inCachedGuild()) return await interaction.reply({ content:"Setup workflows must be run inside a Discord server.", ephemeral:true });
  const action = interaction.customId.split(":").at(-1) as SetupDangerAction | undefined;
  const confirmation = interaction.fields.getTextInputValue(MENU_CUSTOM_IDS.setupConfirmInput).trim();
  if (confirmation !== "CONFIRM") return await interaction.reply({ content:"Setup cancelled. You must type `CONFIRM` exactly to proceed.", ephemeral:true });
  if (action === "server_setup") {
    const result = await recApi.registerServer({ guildId:interaction.guildId, name:interaction.guild.name, setupMode:"manual_first", requestedByDiscordId:interaction.user.id });
    return await interaction.reply({ content:["**Server Setup confirmed.**","",`Server: ${result.server.name}`,`Status: ${result.server.setup_status}`,`Created: ${result.created ? "Yes" : "No, existing server record updated"}`].join("\n"), ephemeral:true });
  }
  if (action === "league_setup") {
    const leagueName = interaction.fields.getTextInputValue(MENU_CUSTOM_IDS.leagueNameInput).trim();
    const result = await recApi.createLeague({ guildId:interaction.guildId, name:leagueName, leagueType:"madden_cfm", currentPhase:"preseason", trustMode:"manual", importEnabled:false, requestedByDiscordId:interaction.user.id });
    return await interaction.reply({ content:["**League Setup confirmed.**","",`League: ${result.league.name}`,`Trust Mode: ${result.league.trust_mode}`,`Import Enabled: ${result.league.import_enabled ? "Yes" : "No"}`].join("\n"), ephemeral:true });
  }
}
await client.login(env.DISCORD_TOKEN);
