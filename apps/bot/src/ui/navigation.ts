import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";

/**
 * Reusable navigation controls for all REC menu windows.
 *
 * Every menu path should include either this row or a custom row containing
 * equivalent Back and Main Menu actions. This keeps Discord navigation from
 * feeling like a dead end as the menu tree grows.
 */
export const NAV_CUSTOM_IDS = {
  back: "rec:nav:back",
  mainMenu: "rec:nav:main_menu",
  adminPanel: "rec:nav:admin_panel"
} as const;

export function buildNavigationRow(options?: {
  includeBack?: boolean;
  includeAdminPanel?: boolean;
  includeMainMenu?: boolean;
}) {
  const includeBack = options?.includeBack ?? true;
  const includeAdminPanel = options?.includeAdminPanel ?? false;
  const includeMainMenu = options?.includeMainMenu ?? true;

  const row = new ActionRowBuilder<ButtonBuilder>();

  if (includeBack) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(NAV_CUSTOM_IDS.back)
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (includeAdminPanel) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(NAV_CUSTOM_IDS.adminPanel)
        .setLabel("Admin Panel")
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (includeMainMenu) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(NAV_CUSTOM_IDS.mainMenu)
        .setLabel("Main Menu")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return row;
}
