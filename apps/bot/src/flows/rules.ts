import { type Interaction } from "discord.js";
import { buildAdminPanelEmbed, buildAdminPanelRows } from "../ui/menu.js";
import { buildRulesPanel } from "../ui/rules.js";

export async function handleRulesSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];
  if (selected === "back_admin") {
    return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
  }
  return interaction.update(buildRulesPanel(selected));
}
