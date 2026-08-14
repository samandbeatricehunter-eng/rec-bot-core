import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { estimateRecPlayerOverall, REC_POSITION_OVR_MODELS } from "../packages/shared/dist/index.js";

const seedUrl = new URL("../docs/legends/shared-catalog-seed.json", import.meta.url);
const baseline = spawnSync("git", ["show", "HEAD:docs/legends/shared-catalog-seed.json"], { encoding: "utf8" });
if (baseline.status !== 0) throw new Error(baseline.stderr || "Unable to load the committed legend seed.");
const catalog = JSON.parse(baseline.stdout);

const codeByName = {
  Speed:"spd",Acceleration:"acc",Agility:"agi",Strength:"str",Awareness:"awr",Carrying:"car","BC Vision":"bcv","Break Tackle":"btk",Trucking:"trk","Stiff Arm":"sfa","Change of Direction":"cod","Spin Move":"spm","Juke Move":"jkm",Catching:"cth","Catch in Traffic":"cit","Spectacular Catch":"spc","Short Route Running":"srr","Medium Route Running":"mrr","Deep Route Running":"drr",Release:"rls",Jumping:"jmp","Throwing Power":"thp","Short Accuracy":"sac","Medium Accuracy":"mac","Deep Accuracy":"dac","Throw on the Run":"run","Throw Under Pressure":"tup","Break Sack":"bsk","Play Action":"pac","Pass Blocking":"pbk","Pass Block Power":"pbp","Pass Block Finesse":"pbf","Run Blocking":"rbk","Run Block Power":"rbp","Run Block Finesse":"rbf","Lead Block":"lbk","Impact Blocking":"ibl","Play Recognition":"prc",Tackling:"tak","Hit Power":"pow","Block Shedding":"bsh","Finesse Moves":"fmv","Power Moves":"pmv",Pursuit:"pur","Man Coverage":"mcv","Zone Coverage":"zcv",Press:"prs","Kicking Power":"kpw","Kicking Accuracy":"kac",Stamina:"sta",Toughness:"tou",Injury:"inj",
};
const positionMap = { OT:"LT", OG:"LG", DE:"LE", OLB:"LOLB", RB:"HB" };
const priorities = {
  QB:["Awareness","Short Accuracy","Medium Accuracy","Deep Accuracy","Throw Under Pressure","Throwing Power","Play Action"],
  HB:["BC Vision","Carrying","Break Tackle","Change of Direction","Acceleration","Speed"], FB:["Lead Block","Impact Blocking","Strength","Carrying","Break Tackle"],
  WR:["Catching","Short Route Running","Medium Route Running","Deep Route Running","Release","Awareness"], TE:["Catching","Catch in Traffic","Medium Route Running","Release","Awareness","Run Blocking"],
  LT:["Pass Blocking","Pass Block Finesse","Pass Block Power","Awareness","Strength","Run Blocking"], RT:["Pass Blocking","Pass Block Power","Run Blocking","Run Block Power","Awareness","Strength"],
  LG:["Run Blocking","Run Block Power","Pass Blocking","Pass Block Power","Awareness","Strength"], RG:["Run Blocking","Run Block Power","Pass Blocking","Pass Block Power","Awareness","Strength"], C:["Awareness","Run Blocking","Pass Blocking","Run Block Finesse","Pass Block Finesse","Strength"],
  LE:["Block Shedding","Power Moves","Finesse Moves","Play Recognition","Pursuit","Strength"], RE:["Block Shedding","Finesse Moves","Power Moves","Play Recognition","Pursuit","Acceleration"], DT:["Block Shedding","Power Moves","Strength","Play Recognition","Tackling","Pursuit"],
  LOLB:["Play Recognition","Pursuit","Tackling","Block Shedding","Zone Coverage","Speed"], ROLB:["Play Recognition","Pursuit","Tackling","Block Shedding","Zone Coverage","Speed"], MLB:["Play Recognition","Tackling","Pursuit","Zone Coverage","Block Shedding","Speed"],
  CB:["Man Coverage","Zone Coverage","Play Recognition","Press","Speed","Acceleration"], FS:["Zone Coverage","Play Recognition","Speed","Pursuit","Man Coverage","Catching"], SS:["Play Recognition","Zone Coverage","Tackling","Hit Power","Pursuit","Speed"],
  K:["Kicking Accuracy","Kicking Power","Awareness"], P:["Kicking Power","Kicking Accuracy","Awareness"],
};
const toModel = (attrs) => Object.fromEntries(Object.entries(attrs).flatMap(([key,value]) => codeByName[key] ? [[codeByName[key], value]] : []));
const calculate = (player) => estimateRecPlayerOverall(positionMap[player.position] ?? player.position, toModel(player.attributes)).displayOverall;

const changed = [];
for (const player of catalog.filter((row) => ["immortal", "legend"].includes(row.legend_tier))) {
  const before = calculate(player);
  const minimum = player.legend_tier === "immortal" ? 91 : 85;
  const modelPosition = positionMap[player.position] ?? player.position;
  const nameByCode = Object.fromEntries(Object.entries(codeByName).map(([name, code]) => [code, name]));
  const modelKeys = Object.entries(REC_POSITION_OVR_MODELS[modelPosition].coefficients)
    .sort(([, left], [, right]) => right - left)
    .map(([code]) => nameByCode[code])
    .filter(Boolean);
  const configured = priorities[modelPosition] ?? [];
  const keys = [...new Set([...modelKeys, ...configured])];
  if (!keys) throw new Error(`No Immortal OVR priorities for ${player.position} (${player.name})`);
  let guard = 0;
  while (calculate(player) < minimum && guard++ < 1000) {
    const key = keys.find((candidate) => Number(player.attributes[candidate] ?? 70) < 99);
    if (!key) throw new Error(`${player.name} cannot reach ${minimum} OVR with its core ratings capped at 99.`);
    player.attributes[key] = Math.min(99, Number(player.attributes[key] ?? 70) + 1);
    if (keys.every((candidate) => player.attributes[candidate] >= 99) && calculate(player) < minimum) {
      throw new Error(`${player.name} cannot reach ${minimum} OVR with its core ratings capped at 99.`);
    }
  }
  player.est_ovr = calculate(player);
  if (before !== player.est_ovr) changed.push({ name: player.name, position: player.position, before, after: player.est_ovr });
}

// Brady's model floor is achieved through elite processing/accuracy, not inflated mobility
// or a 99 arm. Keep the result at 91 while preserving his real pocket-passer identity.
const brady = catalog.find((row) => row.name === "Tom Brady");
if (brady) {
  Object.assign(brady.attributes, {
    "Throwing Power": 95, "Deep Accuracy": 99, "Throw on the Run": 82, "Break Sack": 75,
  });
  brady.abilities = [
    { name: "Omaha", description: "X-Factor: identifies defensive-back coverage before the snap.", type: "xfactor" },
    { name: "Hot Route Master", description: "Expanded hot-route options from the pocket.", type: "superstar" },
    { name: "Fearless", description: "Maintains throwing accuracy while pressured.", type: "superstar" },
    { name: "Protected", description: "Improves pass protection for the offensive line.", type: "superstar" },
  ];
  brady.est_ovr = calculate(brady);
  if (brady.est_ovr <= 90) throw new Error(`Tom Brady remained below the Immortal floor (${brady.est_ovr}).`);
}

fs.writeFileSync(seedUrl, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify({ changed: changed.length, players: changed }, null, 2));
