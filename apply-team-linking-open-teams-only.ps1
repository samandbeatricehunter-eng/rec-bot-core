$ErrorActionPreference = "Stop"

$teamOptionsPath = "apps/bot/src/ui/team-options.ts"
$teamFlowPath = "apps/bot/src/flows/team-linking.ts"

if (!(Test-Path $teamOptionsPath)) { throw "Missing $teamOptionsPath" }
if (!(Test-Path $teamFlowPath)) { throw "Missing $teamFlowPath" }

$teamOptions = Get-Content $teamOptionsPath -Raw
$newBuildTeamSelectRow = @'
export function buildTeamSelectRow(
  conference: "AFC" | "NFC",
  options?: { openTeamAbbreviations?: string[] }
) {
  const allTeams = conference === "AFC" ? AFC_TEAMS : NFC_TEAMS;
  const openSet = options?.openTeamAbbreviations
    ? new Set(options.openTeamAbbreviations)
    : null;
  const teams = openSet ? allTeams.filter((team) => openSet.has(team.abbreviation)) : allTeams;
  const customId = conference === "AFC" ? TEAM_LINK_CUSTOM_IDS.afcTeamSelect : TEAM_LINK_CUSTOM_IDS.nfcTeamSelect;

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(`Select open ${conference} team`);

  if (teams.length > 0) {
    select.addOptions(
      ...teams.map((team) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(team.name)
          .setValue(team.abbreviation)
      )
    );
  } else {
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`No open ${conference} teams`)
        .setValue("NO_OPEN_TEAMS")
        .setDescription("All teams in this conference are already linked.")
    );
  }

  select.addOptions(
    new StringSelectMenuOptionBuilder()
      .setLabel("Custom Team")
      .setValue("CUSTOM_TEAM")
      .setDescription("Custom team replacement flow will be added next.")
  );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}
'@

$teamOptionsPattern = 'export function buildTeamSelectRow\(conference: "AFC" \| "NFC"\) \{[\s\S]*?\n\}'
if ($teamOptions -notmatch $teamOptionsPattern) {
  throw "Could not find buildTeamSelectRow(conference) in $teamOptionsPath. The file may have changed."
}
$teamOptions = [regex]::Replace($teamOptions, $teamOptionsPattern, $newBuildTeamSelectRow, 1)
Set-Content $teamOptionsPath $teamOptions -NoNewline

$teamFlow = Get-Content $teamFlowPath -Raw
$conferenceBlockPattern = 'if \(interaction\.customId === TEAM_LINK_CUSTOM_IDS\.conferenceSelect\) \{[\s\S]*?await interaction\.update\(\{[\s\S]*?components: \[buildTeamSelectRow\(draft\.conference\)\][\s\S]*?\}\);\s*return;\s*\}'
$newConferenceBlock = @'
if (interaction.customId === TEAM_LINK_CUSTOM_IDS.conferenceSelect) {
    if (!interaction.inCachedGuild()) return;

    draft.conference = value as "AFC" | "NFC";
    teamLinkSessions.set(interaction.user.id, draft);

    const openTeamsResult = await recApi.getOpenTeams(interaction.guildId);
    const openTeamAbbreviations = (openTeamsResult.openTeams ?? [])
      .filter((team: any) => team.conference === draft.conference)
      .map((team: any) => team.abbreviation);

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("Link User to Team")
          .setDescription(`Step 4: select an open ${draft.conference} team.`)
      ],
      components: [
        buildTeamSelectRow(draft.conference, { openTeamAbbreviations }),
        buildNavigationRow({ includeAdminPanel: true })
      ]
    });
    return;
  }
'@

if ($teamFlow -notmatch $conferenceBlockPattern) {
  throw "Could not find the conference selection block in $teamFlowPath. The file may have changed."
}
$teamFlow = [regex]::Replace($teamFlow, $conferenceBlockPattern, $newConferenceBlock, 1)

if ($teamFlow -notmatch 'if \(value === "NO_OPEN_TEAMS"\)') {
  $teamFlow = $teamFlow.Replace('if (value === "CUSTOM_TEAM") {', 'if (value === "NO_OPEN_TEAMS") {
      await interaction.reply({
        content: "There are no open teams in that conference. Pick the other conference or unlink a team first.",
        ephemeral: true
      });
      return;
    }

    if (value === "CUSTOM_TEAM") {')
}

Set-Content $teamFlowPath $teamFlow -NoNewline

Write-Host "Applied open-team-only dropdown patch. Run: pnpm typecheck"
