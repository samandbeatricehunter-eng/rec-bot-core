import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MADDEN_RELOCATION_BRANDS } from "../src/madden-relocation.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/assets/relocation-logos");
mkdirSync(outDir, { recursive: true });

function crest(primary: string, secondary: string, letter: string, variant: number): string {
  const shapes = [
    `<polygon points="64,10 118,40 118,96 64,118 10,96 10,40" fill="${secondary}" opacity="0.35"/>`,
    `<circle cx="64" cy="58" r="38" fill="${secondary}" opacity="0.3"/>`,
    `<rect x="22" y="22" width="84" height="84" rx="8" transform="rotate(12 64 64)" fill="${secondary}" opacity="0.28"/>`,
    `<polygon points="64,16 108,64 64,112 20,64" fill="${secondary}" opacity="0.32"/>`,
    `<path d="M24 28h80v52c0 22-18 40-40 40S24 102 24 80V28z" fill="${secondary}" opacity="0.3"/>`,
    `<polygon points="64,12 112,36 96,108 32,108 16,36" fill="${secondary}" opacity="0.3"/>`,
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img">
  <rect width="128" height="128" rx="22" fill="${primary}"/>
  ${shapes[variant % shapes.length]}
  <text x="64" y="78" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="46" font-weight="700" fill="#ffffff">${letter}</text>
</svg>
`;
}

for (const [index, brand] of MADDEN_RELOCATION_BRANDS.entries()) {
  const letter = brand.name.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase() || "R";
  writeFileSync(join(outDir, `${brand.slug}.svg`), crest(brand.primaryColor, brand.secondaryColor, letter, index));
}
console.log(`wrote ${MADDEN_RELOCATION_BRANDS.length} relocation crests to ${outDir}`);
