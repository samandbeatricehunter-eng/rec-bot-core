// Preset defense nicknames — a starting point for coaches who can't think of one, not a
// requirement. Reviewed and approved by the project owner 2026-08-05.
export const DEFENSE_NAME_PRESETS: string[] = [
  "The Iron Curtain", "The Steel Gauntlet", "The Blitz Brigade", "The Concrete Jungle",
  "The No-Fly Line", "The Bone Orchard", "The Wrecking Crew", "The Sack Attack",
  "The Brick Wall", "The Storm Front", "The Iron Fist", "The Hammer Squad",
  "The Vault", "The Fortress", "The Reckoning", "The Enforcers",
  "The Grit Line", "The Trench Titans", "The Purge", "The Bear Trap",
  "The Blackout Brigade", "The Bone Crushers", "The Chaos Crew", "The Dark Horde",
  "The Doom Squad", "The Executioners", "The Fear Factory", "The Ghost Wall",
  "The Grim Reapers", "The Hard Hats", "The Havoc Crew", "The Hunter's Pack",
  "The Ironclad", "The Junkyard Dogs", "The Kill Zone", "The Last Stand",
  "The Line of Fire", "The Mad Dogs", "The Meat Grinder", "The Midnight Watch",
  "The Nightmare Crew", "The No-Trespass Zone", "The Outlaws", "The Pain Train",
  "The Predators", "The Ravage Crew", "The Ravenous", "The Reaper's Row",
  "The Rock Solid", "The Rogue Wave", "The Savage Line", "The Shadow Squad",
  "The Shutdown Unit", "The Siege Engine", "The Silent Assassins", "The Slaughterhouse",
  "The Steel Curtain 2.0", "The Stonewall Crew", "The Sudden Death Squad", "The Terror Front",
  "The Thunder Row", "The Titan Wall", "The Trench Warfare", "The Unbreakable",
  "The Vandals", "The Vengeance Crew", "The Vice Grip", "The Vultures",
  "The War Machine", "The Warpath", "The Widowmakers", "The Wolf Pack",
  "The Wrath", "The Ambush Crew", "The Anarchy", "The Avalanche",
  "The Barbed Wire", "The Berserkers", "The Black Ice", "The Blood Hounds",
  "The Brawlers", "The Cataclysm", "The Cold Front", "The Blood Moon",
  "The Death Row", "The Demolition Crew", "The Doomsday Unit", "The Dread Squad",
  "The Fault Line", "The Firing Squad", "The Gatekeepers", "The Graveyard Shift",
  "The Hitmen", "The Ironwood", "The Juggernauts", "The Lockdown Crew",
  "The Menace", "The Nightstalkers", "The Outbreak", "The Sledgehammers",
];

export function randomDefenseName(exclude?: string | null): string {
  const pool = exclude ? DEFENSE_NAME_PRESETS.filter((name) => name !== exclude) : DEFENSE_NAME_PRESETS;
  return pool[Math.floor(Math.random() * pool.length)] ?? DEFENSE_NAME_PRESETS[0];
}
