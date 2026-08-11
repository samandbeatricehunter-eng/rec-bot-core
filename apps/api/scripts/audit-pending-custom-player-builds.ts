import { REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR, getRecEditableAttributes, type RecGameFamily } from "@rec/shared";
import { supabase } from "../src/lib/supabase.js";
import { sendDiscordDirectMessage } from "../src/lib/discord-guild.js";
import { evaluateCustomPlayer } from "../src/modules/custom-players/custom-players.service.js";
import { createSiteNotification } from "../src/modules/site-notifications/site-notifications.service.js";

async function main() {
  const pending = await supabase.from("rec_custom_player_builds").select("*").eq("status", "pending_review");
  if (pending.error) throw pending.error;

  let valid = 0;
  let rejected = 0;
  for (const build of pending.data ?? []) {
    const attributes = Object.fromEntries(
      getRecEditableAttributes(build.game_family as RecGameFamily, build.position, build.selected_archetype_key)
        .map((code) => [code, Number(build.attributes?.[code] ?? REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR)]),
    );
    let reason = "The saved build no longer passes authoritative validation.";
    try {
      const evaluation = evaluateCustomPlayer({
        game: build.game_family,
        packageTier: build.package_tier,
        position: build.position,
        archetypeKey: build.selected_archetype_key,
        developmentTrait: build.development_trait,
        attributes,
        mode: "submit",
      });
      if (evaluation.valid && evaluation.rawOverall <= 88) {
        valid++;
        continue;
      }
      reason = evaluation.rawOverall > 88
        ? `The build evaluates to ${evaluation.displayOverall} OVR and violates its selected package constraints.`
        : evaluation.violations?.[0]?.message || reason;
    } catch (error) {
      reason = error instanceof Error ? error.message : reason;
    }

    const playerName = `${build.identity?.firstName ?? "Custom"} ${build.identity?.lastName ?? "Player"}`.trim();
    const note = `${playerName} was rejected because ${reason} The ${build.coin_price}-coin purchase was refunded.`;
    const result = await supabase.rpc("reject_custom_player_build", {
      p_build_id: build.id,
      p_reviewer_discord_id: "system-validation-audit",
      p_review_note: note,
    });
    if (result.error) throw new Error(`Failed to reject ${build.id}: ${result.error.message}`);

    await supabase.from("rec_commissioners_inbox").update({
      status: "denied",
      reviewed_by_discord_id: "system-validation-audit",
      reviewed_at: new Date().toISOString(),
      review_reason: note,
    }).eq("source_table", "rec_custom_player_builds").eq("source_id", build.id);

    await createSiteNotification({
      userId: build.user_id,
      leagueId: build.league_id,
      kind: "custom_player_denied",
      title: `${playerName} was rejected and refunded`,
      body: note,
      href: "/app",
    });

    const discord = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", build.user_id).limit(1).maybeSingle();
    let dm = "not linked";
    if (discord.data?.discord_id) {
      try {
        await sendDiscordDirectMessage(discord.data.discord_id, `**Custom player rejected and refunded**\n${note}`);
        dm = "sent";
      } catch (error) {
        dm = `failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    rejected++;
    console.log(JSON.stringify({ buildId: build.id, playerName, reason, refundCoins: build.coin_price, discordDm: dm }));
  }
  console.log(JSON.stringify({ pending: pending.data?.length ?? 0, valid, rejected }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
