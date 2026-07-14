import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const source = resolve(root, "apps/web/src/assets");
const target = resolve(root, "apps/bot/assets");
await mkdir(target, { recursive: true });
for (const name of ["CFB Box Score Example 1.jpg", "CFB Box Score Example 2.jpg"]) {
  await copyFile(resolve(source, name), resolve(target, name));
}
