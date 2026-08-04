import { supabase } from "../../lib/supabase.js";

export const WELCOME_BONUS_AMOUNT = 2000;

// One-time coin grant for a brand-new rec_users row, regardless of which of the two entry
// points created it (site/auth signup via ensureRecUserForAuthUser, or Discord-first team
// linking via createTeamLinkRequest). add_to_wallet's own idempotency check (dedupes on
// user_id + transaction_type + source + source_reference) makes this safe to call more than
// once for the same user — it just returns the existing ledger row instead of double-crediting.
export async function grantWelcomeBonus(userId: string): Promise<void> {
  try {
    await supabase.rpc("add_to_wallet", {
      p_user_id: userId,
      p_amount: WELCOME_BONUS_AMOUNT,
      p_league_id: null,
      p_description: "Welcome bonus — new REC account",
      p_transaction_type: "welcome_bonus",
      p_source: "manual_admin_entry",
      p_source_reference: { reason: "new_user_signup" },
    });
  } catch (err) {
    console.error("[ERROR] Failed to grant welcome bonus (non-fatal):", err);
  }
}
