// One-off: re-run the confirmable-wager check for a league now that loadGameResult no longer
// silently swallows a multi-row match and the underlying duplicate rec_game_results rows are
// gone. Wagers stuck at "pending" with a real scored game should now get their commissioner
// inbox row created.
//
//   pnpm --filter @rec/api exec tsx scripts/resettle-wagers.ts <leagueId>
import { listConfirmableWagers } from "../src/modules/wagers/wagers.service.js";

async function main() {
  const leagueId = process.argv[2];
  if (!leagueId) throw new Error("Usage: resettle-wagers.ts <leagueId>");
  const result = await listConfirmableWagers(leagueId);
  console.log(`Confirmable wagers: ${result.wagers.length}`);
  console.log(result.wagers);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
