/**
 * REC custom-player name corpus.
 * Exactly 300 first names and 300 surnames.
 *
 * Corpus basis: Faker 40.1.2 en_US person provider (MIT license), with the
 * published SSA and U.S. Census aggregate name datasets used as provenance
 * context. No CFB/NFL roster full-name pairs or player identifiers are copied.
 */
export const REC_NAME_CORPUS_VERSION = "rec-names-en-us-v1.0.0" as const;

export const REC_FIRST_NAMES = [
  "Aaron", "Adam", "Adrian", "Alan", "Albert", "Alec",
  "Alejandro", "Alex", "Alexander", "Alexis", "Alfred", "Allen",
  "Andre", "Andres", "Andrew", "Angel", "Anthony", "Antonio",
  "Arthur", "Austin", "Barry", "Benjamin", "Bernard", "Bill",
  "Billy", "Blake", "Bobby", "Brad", "Bradley", "Brady",
  "Brandon", "Brendan", "Brent", "Brett", "Brian", "Bruce",
  "Bryan", "Bryce", "Caleb", "Calvin", "Cameron", "Carl",
  "Carlos", "Casey", "Cesar", "Chad", "Charles", "Chase",
  "Chris", "Christian", "Christopher", "Clarence", "Clayton", "Clifford",
  "Clinton", "Cody", "Cole", "Colin", "Collin", "Colton",
  "Connor", "Corey", "Cory", "Craig", "Cristian", "Curtis",
  "Dakota", "Dale", "Dalton", "Damon", "Dan", "Daniel",
  "Danny", "Darius", "Darrell", "Darren", "Darryl", "Dave",
  "David", "Dean", "Dennis", "Derek", "Derrick", "Devin",
  "Devon", "Dillon", "Dominic", "Don", "Donald", "Douglas",
  "Drew", "Duane", "Dustin", "Dwayne", "Dylan", "Earl",
  "Eddie", "Edgar", "Eduardo", "Edward", "Edwin", "Elijah",
  "Eric", "Erik", "Ernest", "Ethan", "Eugene", "Evan",
  "Fernando", "Francis", "Francisco", "Frank", "Fred", "Frederick",
  "Gabriel", "Garrett", "Gary", "Gavin", "Geoffrey", "George",
  "Gerald", "Glen", "Glenn", "Gordon", "Grant", "Greg",
  "Gregory", "Harold", "Harry", "Hayden", "Hector", "Henry",
  "Howard", "Hunter", "Ian", "Isaac", "Isaiah", "Ivan",
  "Jack", "Jackson", "Jacob", "Jaime", "Jake", "James",
  "Jamie", "Jared", "Jason", "Javier", "Jay", "Jeff",
  "Jeffery", "Jeffrey", "Jeremiah", "Jeremy", "Jermaine", "Jerome",
  "Jerry", "Jesse", "Jesus", "Jim", "Jimmy", "Joe",
  "Joel", "John", "Johnathan", "Johnny", "Jon", "Jonathan",
  "Jonathon", "Jordan", "Jorge", "Jose", "Joseph", "Joshua",
  "Juan", "Julian", "Justin", "Karl", "Keith", "Kelly",
  "Kenneth", "Kent", "Kevin", "Kirk", "Kristopher", "Kurt",
  "Kyle", "Lance", "Larry", "Lawrence", "Lee", "Leonard",
  "Levi", "Logan", "Louis", "Lucas", "Luis", "Luke",
  "Malik", "Manuel", "Marc", "Marco", "Marcus", "Mario",
  "Mark", "Martin", "Marvin", "Mason", "Mathew", "Matthew",
  "Maurice", "Max", "Maxwell", "Melvin", "Michael", "Micheal",
  "Miguel", "Mike", "Mitchell", "Nathan", "Nathaniel", "Nicholas",
  "Nicolas", "Noah", "Norman", "Omar", "Oscar", "Parker",
  "Patrick", "Paul", "Pedro", "Peter", "Philip", "Phillip",
  "Preston", "Ralph", "Randall", "Randy", "Ray", "Raymond",
  "Reginald", "Ricardo", "Richard", "Rick", "Ricky", "Riley",
  "Robert", "Roberto", "Rodney", "Roger", "Ronald", "Ronnie",
  "Ross", "Roy", "Ruben", "Russell", "Ryan", "Samuel",
  "Scott", "Sean", "Sergio", "Seth", "Shane", "Shannon",
  "Shaun", "Shawn", "Spencer", "Stanley", "Stephen", "Steve",
  "Steven", "Tanner", "Taylor", "Terry", "Theodore", "Thomas",
  "Tim", "Timothy", "Todd", "Tom", "Tommy", "Tony",
  "Tracy", "Travis", "Trevor", "Tristan", "Troy", "Tyler",
  "Tyrone", "Victor", "Vincent", "Walter", "Warren", "Wayne",
  "Wesley", "William", "Willie", "Wyatt", "Xavier", "Zachary",
] as const;

export const REC_LAST_NAMES = [
  "Adams", "Aguilar", "Alexander", "Allen", "Alvarado", "Alvarez",
  "Anderson", "Andrews", "Armstrong", "Arnold", "Austin", "Bailey",
  "Baker", "Banks", "Barnes", "Barnett", "Barrett", "Bates",
  "Beck", "Bell", "Bennett", "Berry", "Bishop", "Black",
  "Bowman", "Boyd", "Bradley", "Brewer", "Brooks", "Brown",
  "Bryant", "Burke", "Burns", "Burton", "Butler", "Campbell",
  "Carlson", "Carpenter", "Carr", "Carroll", "Carter", "Castillo",
  "Castro", "Chapman", "Chavez", "Chen", "Clark", "Cole",
  "Coleman", "Collins", "Contreras", "Cook", "Cooper", "Cox",
  "Crawford", "Cruz", "Cunningham", "Curtis", "Daniels", "Davidson",
  "Davis", "Day", "Dean", "Delgado", "Diaz", "Dixon",
  "Douglas", "Duncan", "Dunn", "Edwards", "Elliott", "Ellis",
  "Estrada", "Evans", "Ferguson", "Fernandez", "Fields", "Fisher",
  "Flores", "Ford", "Foster", "Fowler", "Fox", "Franklin",
  "Freeman", "Fuller", "Garcia", "Gardner", "Garrett", "Garza",
  "George", "Gibson", "Gilbert", "Gomez", "Gonzales", "Gonzalez",
  "Gordon", "Graham", "Grant", "Gray", "Green", "Greene",
  "Griffin", "Guerrero", "Gutierrez", "Guzman", "Hall", "Hamilton",
  "Hansen", "Hanson", "Harper", "Harris", "Harrison", "Hart",
  "Harvey", "Hawkins", "Hayes", "Henderson", "Henry", "Hernandez",
  "Herrera", "Hicks", "Hill", "Hoffman", "Holland", "Holmes",
  "Hopkins", "Howard", "Howell", "Hudson", "Hughes", "Hunt",
  "Hunter", "Jackson", "Jacobs", "James", "Jenkins", "Jensen",
  "Jimenez", "Johnson", "Johnston", "Jones", "Jordan", "Keller",
  "Kelley", "Kelly", "Kennedy", "Kim", "King", "Knight",
  "Lane", "Larson", "Lawrence", "Lawson", "Lee", "Lewis",
  "Little", "Long", "Lopez", "Lucas", "Lynch", "Marshall",
  "Martin", "Martinez", "Mason", "Matthews", "May", "Mccoy",
  "Mcdonald", "Medina", "Mendez", "Mendoza", "Meyer", "Miller",
  "Mills", "Mitchell", "Montgomery", "Moore", "Morales", "Moreno",
  "Morgan", "Morris", "Morrison", "Munoz", "Murphy", "Murray",
  "Myers", "Nelson", "Newman", "Nguyen", "Nichols", "Obrien",
  "Oliver", "Olson", "Ortega", "Ortiz", "Owens", "Palmer",
  "Parker", "Patel", "Patterson", "Payne", "Pearson", "Pena",
  "Perez", "Perkins", "Perry", "Peters", "Peterson", "Phillips",
  "Pierce", "Porter", "Powell", "Price", "Ramirez", "Ramos",
  "Ray", "Reed", "Reid", "Reyes", "Reynolds", "Rice",
  "Richards", "Richardson", "Riley", "Rios", "Rivera", "Roberts",
  "Robertson", "Robinson", "Rodriguez", "Rogers", "Romero", "Rose",
  "Ross", "Ruiz", "Russell", "Ryan", "Salazar", "Sanchez",
  "Sanders", "Sandoval", "Santos", "Schmidt", "Schneider", "Schultz",
  "Scott", "Shaw", "Silva", "Simmons", "Simpson", "Sims",
  "Smith", "Snyder", "Soto", "Spencer", "Stanley", "Stephens",
  "Stevens", "Stewart", "Stone", "Sullivan", "Taylor", "Thomas",
  "Thompson", "Torres", "Tran", "Tucker", "Turner", "Valdez",
  "Vargas", "Vasquez", "Wade", "Wagner", "Walker", "Wallace",
  "Walsh", "Walters", "Ward", "Warren", "Washington", "Watkins",
  "Watson", "Weaver", "Webb", "Weber", "Welch", "Wells",
  "West", "Wheeler", "White", "Williams", "Williamson", "Willis",
  "Wilson", "Wong", "Wood", "Woods", "Wright", "Young",
] as const;

export interface RecGeneratedPlayerName {
  firstName: string;
  lastName: string;
  fullName: string;
  corpusVersion: typeof REC_NAME_CORPUS_VERSION;
}

function hashSeed(seed: string | number): number {
  const input = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateRecPlayerName(seed: string | number): RecGeneratedPlayerName {
  const random = mulberry32(hashSeed(seed));
  const firstName = REC_FIRST_NAMES[Math.floor(random() * REC_FIRST_NAMES.length)]!;
  const lastName = REC_LAST_NAMES[Math.floor(random() * REC_LAST_NAMES.length)]!;
  return { firstName, lastName, fullName: `${firstName} ${lastName}`, corpusVersion: REC_NAME_CORPUS_VERSION };
}

export function generateUniqueRecPlayerName(
  seed: string | number,
  usedFullNames: ReadonlySet<string>
): RecGeneratedPlayerName {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = generateRecPlayerName(`${seed}:${attempt}`);
    if (!usedFullNames.has(candidate.fullName.toLowerCase())) return candidate;
  }
  throw new Error("Unable to generate a unique REC player name after 1000 attempts");
}
