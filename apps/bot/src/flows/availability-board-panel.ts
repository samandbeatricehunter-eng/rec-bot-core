import { ButtonInteraction } from "discord.js";
import { handleSetTimezoneSlash } from "./settimezone-slash.js";
import { startAvailabilityWizard } from "./availability-wizard.js";

export const AVAILABILITY_BOARD_CUSTOM_IDS = {
  setAvailability: "rec:availboard:setavailability",
  setTimezone: "rec:availboard:settimezone",
  thisWeek: "rec:availboard:thisweek",
};

export async function handleBoardSetAvailability(interaction: ButtonInteraction) {
  return startAvailabilityWizard(interaction);
}

export async function handleBoardSetTimezone(interaction: ButtonInteraction) {
  return handleSetTimezoneSlash(interaction);
}

// "This Week" jumps straight into the wizard's temporary-mode day grid, skipping the
// routine-vs-temporary mode step since the button already states the intent.
export async function handleBoardThisWeek(interaction: ButtonInteraction) {
  return startAvailabilityWizard(interaction, "temporary");
}
