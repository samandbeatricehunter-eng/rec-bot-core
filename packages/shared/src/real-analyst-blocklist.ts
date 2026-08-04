// Best-effort blocklist of real-world sports broadcasters/analysts, so a commissioner can't
// name a roundtable host after a real person (first+last exact match, case-insensitive).
// Not exhaustive — this is a defensive filter, not a comprehensive database of every sports
// media figure; update as needed.
export const REAL_SPORTS_ANALYST_NAMES: string[] = [
  "Stephen A Smith", "Skip Bayless", "Shannon Sharpe", "Colin Cowherd", "Chris Broussard",
  "Michael Wilbon", "Tony Kornheiser", "Max Kellerman", "Molly Qerim", "Pat McAfee",
  "Rich Eisen", "Dan Patrick", "Mike Greenberg", "Mina Kimes", "Jason Kelce",
  "Cris Collinsworth", "Tony Romo", "Troy Aikman", "Joe Buck", "Al Michaels",
  "Kirk Herbstreit", "Chris Fowler", "Lee Corso", "Desmond Howard", "Pat McAfee",
  "David Pollack", "Jesse Palmer", "Rece Davis", "Nick Saban", "Booger McFarland",
  "Charles Davis", "Greg Olsen", "Kurt Warner", "Adam Schefter", "Ian Rapoport",
  "Mike Florio", "Peter King", "Bill Simmons", "Nate Burleson", "Kay Adams",
  "Jason Whitlock", "Doug Gottlieb", "Emmanuel Acho", "Jim Rome", "Colin Fleming",
  "Ryen Russillo", "Bomani Jones", "Domonique Foxworth", "Sarah Spain", "Jemele Hill",
  "Michael Irvin", "Terry Bradshaw", "Howie Long", "Jimmy Johnson", "Curt Menefee",
  "Rob Stone", "Charissa Thompson", "Erin Andrews", "Jay Glazer", "Chris Myers",
  "Joe Davis", "Kevin Burkhardt", "Greg Gumbel", "Nate Boyer", "Boomer Esiason",
  "Phil Simms", "James Brown", "Bill Cowher", "Nate Burleson", "Andrew Siciliano",
  "Colin Montgomerie", "Trey Wingo", "Suzy Kolber", "Chris Berman", "Randy Moss",
  "Mark Schlereth", "Marcus Spears", "Robert Griffin", "Louis Riddick", "Dan Orlovsky",
  "Todd McShay", "Mel Kiper", "Field Yates", "Bruce Feldman", "Joel Klatt",
  "Yogi Roth", "Cole Cubelic", "Roman Harper", "Aaron Taylor", "Brock Huard",
];

const REAL_NAME_SET = new Set(REAL_SPORTS_ANALYST_NAMES.map((n) => n.trim().toLowerCase()));

export function isRealSportsAnalystName(fullName: string): boolean {
  return REAL_NAME_SET.has(fullName.trim().toLowerCase());
}
