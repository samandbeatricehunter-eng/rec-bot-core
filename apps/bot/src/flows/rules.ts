import { MessageFlags, type Interaction } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { buildAdminPanelEmbed, buildAdminPanelRows } from "../ui/menu.js";
import { buildRulesPanel } from "../ui/rules.js";

export async function handleRulesSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];
  if (selected === "back_admin") {
    // Help/Rules is open to every user, but the Admin Panel it links back to is not —
    // a non-admin who opened Help/Rules must not be able to jump into it from here.
    if (!isDiscordAdminInteraction(interaction)) {
      return interaction.reply({ content: "Only commissioners or server admins can open the Admin Panel.", flags: MessageFlags.Ephemeral });
    }
    return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
  }
  return interaction.update(buildRulesPanel(selected));
}
