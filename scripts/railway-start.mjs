import { spawn } from "node:child_process";

const service = (process.env.RAILWAY_SERVICE_NAME || "").toLowerCase();

function filterForService() {
  if (service.includes("site")) return "@rec/site";
  if (service.includes("bot")) return "@rec/bot";
  if (service.includes("web")) return "@rec/web";
  return "@rec/api";
}

const filter = filterForService();
const child = spawn("pnpm", ["--filter", filter, "start"], { stdio: "inherit", shell: true });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
