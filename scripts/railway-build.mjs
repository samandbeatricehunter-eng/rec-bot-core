import { spawn } from "node:child_process";

const service = (process.env.RAILWAY_SERVICE_NAME || "").toLowerCase();

// @rec/web has no deployable app of its own (removed — see apps/web/README.md); it's
// component source consumed by @rec/site's build, not a Railway service target.
function filtersForService() {
  if (service.includes("site")) return ["@rec/shared", "@rec/site"];
  if (service.includes("bot")) return ["@rec/shared", "@rec/bot"];
  return ["@rec/shared", "@rec/api"];
}

const filters = filtersForService();
const args = ["--filter", filters[0], "build"];
for (let i = 1; i < filters.length; i += 1) {
  args.push("--filter", filters[i], "build");
}

console.log(`[railway-build] service=${service || "(unset)"} → ${filters.join(", ")}`);

async function run() {
  for (const pkg of filters) {
    await new Promise((resolve, reject) => {
      const child = spawn("pnpm", ["--filter", pkg, "build"], { stdio: "inherit", shell: true });
      child.on("exit", (code) => {
        if (code) reject(new Error(`build failed for ${pkg} (exit ${code})`));
        else resolve();
      });
    });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
