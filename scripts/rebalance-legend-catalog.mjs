import fs from "node:fs";
import { estimateRecPlayerOverall } from "../packages/shared/dist/index.js";

const seedPath = new URL("../docs/legends/shared-catalog-seed.json", import.meta.url);
const migrationPath = new URL("../supabase/migrations/20260813203000_rebalance_legend_catalog.sql", import.meta.url);
const batchDir = new URL("../docs/legends/_rebalance_batches/", import.meta.url);
const catalog = JSON.parse(fs.readFileSync(seedPath, "utf8"));

const removals = [
  "Andre Ware", "Bubby Brister", "Bobby Hebert", "Jeff Hostetler", "Neil O'Donnell",
  "Archie Manning", "Bill Wade", "Dave Krieg", "Greg Landry", "Jim Harbaugh", "Jim Hart",
  "Jim Zorn", "Ken O'Brien", "Lynn Dickey", "Steve Bartkowski", "Steve Grogan", "Tim Tebow",
  "Tommie Frazier", "Tommy Kramer", "Ty Detmer",
  "Barry Foster", "Chris Warren", "Dalton Hilliard", "Greg Bell", "Natrone Means", "Reggie Cobb",
  "Ronnie Bull", "Tony Nathan", "Archie Griffin", "Billy Sims", "Chuck Foreman", "Chuck Muncie",
  "Christian Okoye", "Curt Warner", "Dave Meggett", "Eric Bieniemy", "Freeman McNeil", "Ickey Woods",
  "Matt Snell", "Mike Rozier", "Ottis Anderson", "Reggie Bush", "Ricky Watters", "Steve Owens",
  "Alvin Harper", "Kevin Curtis", "Mark Carrier", "Michael Crabtree", "Rob Moore", "Tony Martin",
  "Yancey Thigpen", "Anthony Carter", "Desmond Howard", "Eric Martin", "Gary Clark", "Henry Ellard",
  "Herman Moore", "Irving Fryar", "John Jefferson", "John Taylor", "Raghib \"Rocket\" Ismail",
  "Rick Upchurch", "Ricky Sanders", "Steve Tasker", "Wesley Walker", "Willie Gault",
  "Kellen Winslow II", "Pete Metzelaars", "Troy Drayton",
  "Tony Mandarich", "Bubba Paris", "Richie Incognito", "Guy McIntyre",
  "Mike Golic", "Rulon Jones", "Tony Tolbert", "Brian Jones", "Lamar Lathon",
  "Chuck Noll", "Gary Plummer", "Solomon Wilcots", "Fred Marion", "Al Del Greco", "Jeff Jaeger",
];

const ability = (name, description) => ({ name, description, type: "superstar" });
const definitions = [
  ["Brett Favre","QB","John Elway","6'2\"",222,"Right",4,"Southern Miss","Strong-arm improviser","Fearless vertical passer with rare arm strength, toughness and off-platform creation.",[ability("Gunslinger","Faster throwing animations and elite velocity."),ability("Fearless","Maintains accuracy against pressure."),ability("Long Range Deadeye","Excels attacking deep zones.")]],
  ["Drew Brees","QB","Peyton Manning","6'0\"",209,"Right",9,"Purdue","Precision field general","Anticipation-driven distributor with historic accuracy, pocket movement and pre-snap command.",[ability("Hot Route Master","Expanded route adjustments before the snap."),ability("Pass Lead Elite","Elite placement away from coverage."),ability("Pocket Deadeye","Pinpoint accuracy from a clean pocket.")]],
  ["Terry Bradshaw","QB","Brett Favre","6'3\"",215,"Right",12,"Louisiana Tech","Vertical field general","Big-game downfield passer with a powerful arm, physical toughness and aggressive mentality.",[ability("Set Feet Lead","Extra velocity on set-foot throws."),ability("Fearless","Stands tall against interior pressure."),ability("Deep Range Deadeye","Accurate on vertical throws.")]],
  ["Jim Kelly","QB","John Elway","6'3\"",226,"Right",12,"Miami","No-huddle field general","Tough, decisive passer built around tempo, intermediate timing and aggressive downfield reads.",[ability("Hot Route Master","Controls the offense before the snap."),ability("Gunslinger","Quick release with high-end velocity."),ability("Fearless","Resists pressure penalties.")]],
  ["Dan Fouts","QB","Dan Marino","6'3\"",204,"Right",14,"Oregon","Vertical pocket passer","Air Coryell distributor with elite downfield anticipation, volume and pocket command.",[ability("Set Feet Lead","Drives deep throws from the pocket."),ability("Long Range Deadeye","Accurate on deep passes."),ability("Pocket Deadeye","Elite clean-pocket placement.")]],
  ["Franco Harris","RB","Jim Brown","6'2\"",230,"Right",32,"Penn State","Power back","Patient, durable downhill runner with balance, receiving value and postseason reliability.",[ability("Bruiser","Improved trucking and stiff arms."),ability("Balance Beam","Resists stumbling through contact."),ability("Reach For It","Fights for extra yardage.")]],
  ["John Riggins","RB","Earl Campbell","6'2\"",235,"Right",44,"Kansas","Power back","Large, relentless workhorse who wore defenses down and finished runs through contact.",[ability("Freight Train","Builds momentum through repeated successful runs."),ability("Bruiser","Dominant trucking and stiff-arm moves."),ability("Goal Line Back","Excels in short-yardage situations.")]],
  ["Terrell Davis","RB","Eric Dickerson","5'11\"",210,"Right",30,"Georgia","One-cut zone runner","Decisive one-cut runner with elite vision, burst, balance and postseason production.",[ability("One Cut","Explosive cuts on zone runs."),ability("Evasive","Sharper jukes and spins."),ability("Clutch","Raises performance in high-leverage moments.")]],
  ["Jerome Bettis","RB","Earl Campbell","5'11\"",252,"Right",36,"Notre Dame","Power back","Massive, nimble interior runner who combined elite contact balance with surprising feet.",[ability("Freight Train","Gains momentum through contact."),ability("Tank","Breaks hit-stick tackle attempts."),ability("Goal Line Back","Dominant near the goal line.")]],
  ["Edgerrin James","RB","Marshall Faulk","6'0\"",219,"Right",32,"Miami","Complete back","Vision-driven workhorse with patience, lateral agility, receiving skill and pass protection.",[ability("Backfield Master","Expanded receiving routes and improved catches."),ability("Evasive","Elite open-field moves."),ability("First One Free","Improved chance to beat the first defender.")]],
  ["Marion Motley","FB","Jim Taylor","6'1\"",232,"Right",76,"Nevada","Two-way power fullback","Foundational power runner and blocker with rare size, speed and defensive toughness.",[ability("Bruiser","Powerful trucks and stiff arms."),ability("Honorary Lineman","High-impact lead blocking."),ability("Tank","Resists hit-stick tackles.")]],
  ["Marvin Harrison","WR","Jerry Rice","6'0\"",185,"Right",88,"Syracuse","Route technician","Exceptionally precise separator with elite hands, boundary awareness and sustained production.",[ability("Route Technician","Wins more consistently on route breaks."),ability("Outside Apprentice","Expanded outside receiver route tree."),ability("Deep Out Elite","Excels on deep outside catches.")]],
  ["Isaac Bruce","WR","Steve Largent","6'0\"",188,"Right",80,"Memphis","Polished deep receiver","Smooth route runner with deceptive acceleration, sideline control and vertical tracking.",[ability("Route Technician","Creates separation on breaks."),ability("Deep Out Elite","Improved deep outside catching."),ability("Mid In Elite","Excels between the numbers.")]],
  ["Torry Holt","WR","Andre Johnson","6'0\"",190,"Right",81,"NC State","Vertical route runner","Explosive, technically clean receiver with elite intermediate and deep-route pacing.",[ability("Route Technician","Sharp separation at every level."),ability("Deep In Elite","Excels on deep routes inside the numbers."),ability("Slot-O-Matic","Improved slot separation and catching.")]],
  ["Kellen Winslow Sr.","TE","Antonio Gates","6'5\"",250,"Right",80,"Missouri","Move tight end","Era-defining receiving tight end with wide-receiver movement skills and contested-catch ability.",[ability("Matchup Nightmare","Wins against linebackers and safeties."),ability("TE Apprentice","Expanded tight-end route tree."),ability("Deep Out Elite","Threatens defenses vertically outside.")]],
  ["Willie Roaf","OT","Anthony Munoz","6'5\"",320,"Right",77,"Louisiana Tech","Power tackle","Massive, athletic blind-side protector with elite anchor, balance and run-game power.",[ability("Edge Protector","Improved protection against elite edge rushers."),ability("Secure Protector","Reduces quick block sheds."),ability("Nasty Streak","Finishes blocks in space.")]],
  ["Art Shell","OT","Roosevelt Brown","6'5\"",265,"Right",78,"Maryland Eastern Shore","Power tackle","Long, powerful cornerstone tackle with outstanding leverage and sustained-block strength.",[ability("Edge Protector","Neutralizes edge pressure."),ability("Post Up","Dominant on double teams."),ability("Nasty Streak","Punishing blocker in space.")]],
  ["Jackie Slater","OT","Orlando Pace","6'4\"",277,"Right",78,"Jackson State","Technician tackle","Exceptionally durable technician with balanced pass sets, recovery skill and run blocking.",[ability("Edge Protector","Handles speed and power rushers."),ability("Secure Protector","Maintains blocks longer."),ability("All Day","Resists pass-rush fatigue.")]],
  ["Bruce Matthews","OG","Larry Allen","6'5\"",305,"Right",74,"USC","Complete interior lineman","Elite, durable multi-position blocker combining leverage, intelligence, mobility and power.",[ability("Secure Protector","Sustains interior pass protection."),ability("Puller Elite","Excels as a pulling blocker."),ability("Post Up","Dominant on double teams.")]],
  ["Steve Hutchinson","OG","John Hannah","6'5\"",313,"Right",76,"Michigan","Power guard","Explosive, technically sound left guard who displaced defenders and anchored elite rushing attacks.",[ability("Puller Elite","Dominant on pulls and traps."),ability("Nasty Streak","Finishes blocks in space."),ability("Post Up","Excels on double teams.")]],
  ["Alan Faneca","OG","Randall McDaniel","6'5\"",316,"Right",66,"LSU","Athletic power guard","Mobile, physical guard with elite pulling ability, consistency and second-level range.",[ability("Puller Elite","Elite lead blocker in space."),ability("Secure Protector","Reliable interior protection."),ability("Nasty Streak","Physical finishing blocker.")]],
  ["Kevin Mawae","C","Mike Webster","6'4\"",289,"Right",68,"LSU","Athletic center","Intelligent, mobile pivot with elite reach-blocking, toughness and protection calls.",[ability("Identifier","Recognizes pressure threats before the snap."),ability("All Day","Resists pass-rush fatigue."),ability("Puller Elite","Excels blocking in space.")]],
  ["Jim Ringo","C","Jim Otto","6'1\"",232,"Right",51,"Syracuse","Technician center","Undersized but exceptionally quick and durable center who mastered leverage and positioning.",[ability("Identifier","Directs protection adjustments."),ability("Secure Protector","Sustains interior blocks."),ability("Post Up","Excels with combo blocks.")]],
  ["Michael Strahan","DE","Reggie White","6'5\"",255,"Right",92,"Texas Southern","Power edge","Relentless left-end technician with leverage, hand power and elite run defense.",[ability("Edge Threat","Improved edge pressure."),ability("Power Specialist","Dominant power-rush moves."),ability("No Outsiders","Shuts down outside runs.")]],
  ["Howie Long","DE","Jack Youngblood","6'5\"",265,"Right",75,"Villanova","Power edge","Explosive, versatile front-line defender with power, technique and inside-out flexibility.",[ability("Edge Threat","Fast edge get-off."),ability("El Toro","Converts speed to power."),ability("Run Stopper","Disrupts rushing lanes.")]],
  ["Charles Haley","DE","Bruce Smith","6'5\"",252,"Right",94,"James Madison","Speed-power edge","Long, intense championship pass rusher with burst, bend and inside counter power.",[ability("Edge Threat Elite","Elite pressure from the edge."),ability("Strip Specialist","Creates fumbles on sacks."),ability("Speedster","Wins with speed rushes.")]],
  ["Jason Taylor","DE","Julius Peppers","6'6\"",244,"Right",99,"Akron","Speed edge","Long, fluid edge defender with elite burst, bend, pursuit and turnover production.",[ability("Edge Threat Elite","Elite edge pressure."),ability("Speedster","Wins quickly with speed."),ability("Strip Specialist","Attacks the football on sacks.")]],
  ["John Randle","DT","Aaron Donald","6'1\"",290,"Right",93,"Texas A&I","Penetrating three-technique","Explosive interior pass rusher with leverage, violent hands and relentless effort.",[ability("Inside Stuff","Disrupts inside runs."),ability("El Toro","Converts burst into power."),ability("Unpredictable","Varied pass-rush plan limits resistance.")]],
  ["Warren Sapp","DT","Mean Joe Greene","6'2\"",303,"Right",99,"Miami","Penetrating three-technique","Rare first-step interior disruptor with power, agility and backfield production.",[ability("Inside Stuff","Dominates interior run fits."),ability("Under Pressure","Disrupts nearby quarterback accuracy."),ability("El Toro","Elite bull-rush conversion.")]],
  ["Junior Seau","OLB","Ted Hendricks","6'3\"",250,"Right",55,"USC","Sideline-to-sideline linebacker","Explosive, instinctive playmaker with rare pursuit range, intensity and blitz timing.",[ability("Enforcer","Creates stronger contact outcomes."),ability("Lurker","Improved jumping interceptions."),ability("Secure Tackler","Finishes tackles reliably.")]],
  ["Derrick Brooks","OLB","Jack Ham","6'0\"",235,"Right",55,"Florida State","Coverage linebacker","Fast, instinctive space defender with elite zone awareness, tackling and turnover production.",[ability("Flat Zone KO","Improved reactions in underneath zones."),ability("Lurker","Attacks passing lanes."),ability("Secure Tackler","Consistent open-field tackling.")]],
  ["Brian Urlacher","MLB","Luke Kuechly","6'4\"",258,"Right",54,"New Mexico","Coverage middle linebacker","Rare size-speed field general with elite range, zone instincts and downhill closing ability.",[ability("Lurker","Elite passing-lane range."),ability("Mid Zone KO","Improved middle-zone reactions."),ability("Secure Tackler","Reliable tackling in space.")]],
  ["Mel Blount","CB","Night Train Lane","6'3\"",205,"Right",47,"Southern","Physical press corner","Prototype big press corner whose length, strength and ball skills reshaped coverage rules.",[ability("One Step Ahead","React quickly in man coverage."),ability("Bench Press","Disrupts releases with physical jams."),ability("Pick Artist","Improved interception success.")]],
  ["Herb Adderley","CB","Charles Woodson","6'0\"",206,"Right",26,"Michigan State","Complete corner","Smooth, physical coverage defender with elite recovery speed, ball skills and return value.",[ability("Acrobat","Improved diving plays on the ball."),ability("Pick Artist","Finishes interception opportunities."),ability("Deep Route KO","Disrupts vertical catches.")]],
  ["Ty Law","CB","Darrelle Revis","5'11\"",200,"Right",24,"Michigan","Press-man corner","Physical, intelligent matchup corner with route recognition and postseason ball production.",[ability("One Step Ahead","Elite man-coverage reactions."),ability("Bench Press","Controls receivers at the line."),ability("Pick Artist","Capitalizes on turnover chances.")]],
  ["Yale Lary","FS","Paul Krause","5'11\"",185,"Right",28,"Texas A&M","Center-field safety","Range-based ball hawk and elite punter who combined anticipation with open-field reliability.",[ability("Deep Zone KO","Improved reactions in deep zones."),ability("Pick Artist","Finishes interceptions."),ability("Secure Tackler","Reliable last-line tackling.")]],
  ["John Lynch","SS","Steve Atwater","6'2\"",220,"Right",47,"Stanford","Box safety","Physical, intelligent safety with downhill force, leadership and dependable zone awareness.",[ability("Enforcer","Delivers impactful contact."),ability("Secure Tackler","Finishes open-field tackles."),ability("Flat Zone KO","Disrupts underneath throws.")]],
  ["Adam Vinatieri","K","Jan Stenerud","6'0\"",202,"Right",4,"South Dakota State","Clutch placekicker","Historic pressure kicker with repeatable mechanics, cold-weather reliability and longevity.",[ability("Clutch Kicker","Resists pressure effects on late kicks."),ability("Focused Kicker","Slower kick-meter movement."),ability("Zen Kicker","Improved kick-meter stability.")]],
  ["Morten Andersen","K","Lou Groza","6'2\"",218,"Left",7,"Michigan State","Power placekicker","Long-range left-footed scorer with elite leg strength, consistency and unprecedented longevity.",[ability("Zen Kicker","Improved kick-meter stability."),ability("Focused Kicker","Slower kick-meter movement."),ability("Clutch Kicker","Reliable in pressure situations.")]],
  ["Gary Anderson","K","Eddie Murray","5'11\"",193,"Right",1,"Syracuse","Accuracy placekicker","Smooth, dependable technician known for accuracy, consistency and long-term production.",[ability("Focused Kicker","Slower kick-meter movement."),ability("Zen Kicker","Improved kick-meter stability."),ability("Clutch Kicker","Resists late-game pressure.")]],
  ["Shane Lechler","P","Ray Guy","6'2\"",230,"Right",9,"Texas A&M","Power punter","Generational punter with elite distance, hang time, directional control and consistency.",[ability("Punt Elite","Improved punt power and placement."),ability("Precision Kicker","Improved directional accuracy."),ability("Clutch Kicker","Resists pressure effects.")]],
];

const attributeCodeByName = {
  Speed:"spd",Acceleration:"acc",Agility:"agi",Strength:"str",Awareness:"awr",Carrying:"car",
  "BC Vision":"bcv","Break Tackle":"btk",Trucking:"trk","Stiff Arm":"sfa","Change of Direction":"cod",
  "Spin Move":"spm","Juke Move":"jkm",Catching:"cth","Catch in Traffic":"cit","Spectacular Catch":"spc",
  "Short Route Running":"srr","Medium Route Running":"mrr","Deep Route Running":"drr",Release:"rls",
  Jumping:"jmp","Throwing Power":"thp","Short Accuracy":"sac","Medium Accuracy":"mac","Deep Accuracy":"dac",
  "Throw on the Run":"run","Throw Under Pressure":"tup","Break Sack":"bsk","Play Action":"pac",
  "Pass Blocking":"pbk","Pass Block Power":"pbp","Pass Block Finesse":"pbf","Run Blocking":"rbk",
  "Run Block Power":"rbp","Run Block Finesse":"rbf","Lead Block":"lbk","Impact Blocking":"ibl",
  "Play Recognition":"prc",Tackling:"tak","Hit Power":"pow","Block Shedding":"bsh","Finesse Moves":"fmv",
  "Power Moves":"pmv",Pursuit:"pur","Man Coverage":"mcv","Zone Coverage":"zcv",Press:"prs",
  "Kick/Punt Return":"ret","Kicking Power":"kpw","Kicking Accuracy":"kac",Stamina:"sta",Toughness:"tou",Injury:"inj",
};
const ovrPosition = { OT:"LT", OG:"LG", DE:"LE", OLB:"LOLB", RB:"HB" };
const toOvr = (attributes) => Object.fromEntries(Object.entries(attributes).flatMap(([key,value]) => attributeCodeByName[key] ? [[attributeCodeByName[key],value]] : []));
const removed = new Set(removals);
const byName = new Map(catalog.map((player) => [player.name, player]));
const additionPositionOverrides = {
  "Franco Harris":"HB", "John Riggins":"HB", "Terrell Davis":"HB", "Jerome Bettis":"HB", "Edgerrin James":"HB",
  "Willie Roaf":"LT", "Art Shell":"LT", "Jackie Slater":"RT",
  "Bruce Matthews":"LG", "Steve Hutchinson":"LG", "Alan Faneca":"LG",
  "Michael Strahan":"LE", "Howie Long":"LE", "Charles Haley":"RE", "Jason Taylor":"LE",
  "Junior Seau":"LOLB", "Derrick Brooks":"ROLB",
};
const additionKeys = new Set(definitions.map(([name, position]) => `${name}::${additionPositionOverrides[name] ?? position}`));
const signatureOverrides = {
  "Brett Favre": { "Throwing Power":99,"Deep Accuracy":94,"Throw on the Run":94,"Break Sack":93,"Toughness":99,"Awareness":94 },
  "Drew Brees": { "Short Accuracy":99,"Medium Accuracy":99,"Deep Accuracy":95,"Awareness":99,"Play Action":96,"Throwing Power":90 },
  "Terry Bradshaw": { "Throwing Power":97,"Short Accuracy":91,"Medium Accuracy":92,"Deep Accuracy":96,"Awareness":94,"Toughness":98 },
  "Jim Kelly": { "Throwing Power":96,"Short Accuracy":95,"Medium Accuracy":96,"Deep Accuracy":94,"Awareness":96,"Toughness":98 },
  "Dan Fouts": { "Throwing Power":95,"Short Accuracy":94,"Medium Accuracy":97,"Deep Accuracy":96,"Awareness":97,"Play Action":96 },
  "Franco Harris": { "BC Vision":96,"Carrying":96,"Break Tackle":95,"Trucking":93,"Stiff Arm":94,"Catching":82 },
  "John Riggins": { "Strength":94,"Carrying":97,"BC Vision":95,"Break Tackle":97,"Trucking":98,"Stiff Arm":97 },
  "Terrell Davis": { "Speed":94,"Acceleration":96,"BC Vision":99,"Carrying":97,"Change of Direction":95,"Break Tackle":94 },
  "Jerome Bettis": { "Strength":97,"Carrying":96,"Break Tackle":98,"Trucking":99,"Stiff Arm":97,"Agility":86 },
  "Edgerrin James": { "BC Vision":98,"Carrying":97,"Break Tackle":95,"Juke Move":94,"Catching":88,"Pass Blocking":78 },
  "Marion Motley": { "Speed":91,"Strength":98,"Trucking":98,"Break Tackle":97,"Lead Block":94,"Impact Blocking":95 },
  "Marvin Harrison": { "Catching":98,"Release":97,"Short Route Running":98,"Medium Route Running":99,"Deep Route Running":98,"Spectacular Catch":94 },
  "Isaac Bruce": { "Speed":94,"Catching":96,"Release":95,"Medium Route Running":97,"Deep Route Running":97,"Awareness":96 },
  "Torry Holt": { "Speed":96,"Acceleration":97,"Catching":96,"Medium Route Running":98,"Deep Route Running":98,"Release":95 },
  "Kellen Winslow Sr.": { "Speed":91,"Catching":97,"Catch in Traffic":97,"Spectacular Catch":95,"Medium Route Running":96,"Release":94 },
  "Willie Roaf": { "Strength":98,"Awareness":98,"Pass Blocking":97,"Run Blocking":97,"Pass Block Power":98,"Run Block Power":98 },
  "Art Shell": { "Strength":97,"Awareness":97,"Pass Blocking":96,"Run Blocking":97,"Pass Block Power":97,"Impact Blocking":96 },
  "Jackie Slater": { "Strength":96,"Awareness":99,"Pass Blocking":97,"Run Blocking":95,"Pass Block Finesse":97,"Toughness":99 },
  "Bruce Matthews": { "Strength":96,"Awareness":99,"Pass Blocking":98,"Run Blocking":98,"Pass Block Finesse":97,"Run Block Finesse":97 },
  "Steve Hutchinson": { "Strength":98,"Awareness":97,"Run Blocking":99,"Run Block Power":99,"Impact Blocking":98,"Pass Blocking":95 },
  "Alan Faneca": { "Strength":96,"Awareness":97,"Run Blocking":98,"Run Block Finesse":98,"Lead Block":96,"Pass Blocking":95 },
  "Kevin Mawae": { "Strength":93,"Awareness":99,"Run Blocking":97,"Run Block Finesse":98,"Pass Blocking":96,"Lead Block":96 },
  "Jim Ringo": { "Strength":90,"Awareness":99,"Run Blocking":96,"Run Block Finesse":98,"Pass Blocking":95,"Agility":88 },
  "Michael Strahan": { "Strength":95,"Play Recognition":97,"Block Shedding":97,"Power Moves":98,"Finesse Moves":94,"Pursuit":98 },
  "Howie Long": { "Strength":96,"Block Shedding":95,"Power Moves":97,"Finesse Moves":91,"Pursuit":95,"Tackling":95 },
  "Charles Haley": { "Speed":90,"Acceleration":95,"Block Shedding":94,"Finesse Moves":97,"Power Moves":95,"Pursuit":96 },
  "Jason Taylor": { "Speed":91,"Acceleration":96,"Finesse Moves":98,"Block Shedding":94,"Pursuit":98,"Play Recognition":96 },
  "John Randle": { "Acceleration":94,"Strength":92,"Block Shedding":96,"Finesse Moves":99,"Power Moves":95,"Pursuit":98 },
  "Warren Sapp": { "Acceleration":93,"Strength":96,"Block Shedding":97,"Power Moves":98,"Finesse Moves":96,"Play Recognition":97 },
  "Junior Seau": { "Speed":92,"Acceleration":95,"Tackling":98,"Pursuit":99,"Play Recognition":97,"Hit Power":97 },
  "Derrick Brooks": { "Speed":93,"Acceleration":95,"Tackling":97,"Pursuit":98,"Play Recognition":99,"Zone Coverage":98 },
  "Brian Urlacher": { "Speed":93,"Acceleration":94,"Tackling":97,"Pursuit":98,"Play Recognition":98,"Zone Coverage":96 },
  "Mel Blount": { "Strength":94,"Man Coverage":98,"Zone Coverage":94,"Press":99,"Play Recognition":97,"Catching":88 },
  "Herb Adderley": { "Speed":95,"Acceleration":96,"Man Coverage":96,"Zone Coverage":97,"Play Recognition":97,"Catching":91 },
  "Ty Law": { "Speed":93,"Man Coverage":98,"Zone Coverage":94,"Press":97,"Play Recognition":98,"Catching":88 },
  "Yale Lary": { "Speed":92,"Zone Coverage":97,"Man Coverage":91,"Play Recognition":98,"Catching":93,"Pursuit":94 },
  "John Lynch": { "Tackling":97,"Hit Power":98,"Play Recognition":98,"Zone Coverage":94,"Pursuit":97,"Strength":91 },
  "Adam Vinatieri": { "Kicking Power":95,"Kicking Accuracy":99,"Awareness":99,"Toughness":99 },
  "Morten Andersen": { "Kicking Power":99,"Kicking Accuracy":96,"Awareness":98,"Stamina":98 },
  "Gary Anderson": { "Kicking Power":93,"Kicking Accuracy":98,"Awareness":98,"Stamina":97 },
  "Shane Lechler": { "Kicking Power":99,"Kicking Accuracy":97,"Awareness":98,"Stamina":98 },
};
const retained = catalog
  .filter((player) => !removed.has(player.name) && !additionKeys.has(`${player.name}::${player.position}`) && !(player.name === "Sammy Baugh" && player.position === "P"))
  .map((player) => ({ ...player, catalog_group: player.catalog_group ?? "current_catalog" }));
const additions = definitions.map(([name,position,templateName,height,weight,hand,jersey_number,college,archetype,build_note,abilities]) => {
  position = additionPositionOverrides[name] ?? position;
  const template = byName.get(templateName);
  if (!template) throw new Error(`Missing template ${templateName} for ${name}`);
  const attributes = structuredClone(template.attributes);
  Object.assign(attributes, signatureOverrides[name] ?? {});
  const est_ovr = estimateRecPlayerOverall(ovrPosition[position] ?? position, toOvr(attributes)).displayOverall;
  return {
    name, position, position_group: ["QB","HB","FB","WR","TE","LT","LG","C","RG","RT","K","P"].includes(position) ? "offense" : "defense",
    legend_tier: "legend", dev_trait: "superstar", est_ovr, height, weight, hand, jersey_number,
    archetype, build_note, college, body_type: template.body_type, photo_url: null, attributes, abilities,
    source_2k8_class: null, source_2k8_pos: null, abilities_2k8: null, game_scope: "madden", catalog_group: "notable_addition",
  };
});

const finalCatalog = [...retained, ...additions];
fs.writeFileSync(seedPath, `${JSON.stringify(finalCatalog, null, 2)}\n`);

const q = (value) => value == null ? "null" : `'${String(value).replaceAll("'","''")}'`;
const sammy = finalCatalog.find((player) => player.name === "Sammy Baugh" && player.position === "QB");
if (!sammy) throw new Error("Canonical Sammy Baugh QB row is missing.");
fs.writeFileSync(new URL("../supabase/migrations/20260813204000_dedupe_sammy_baugh.sql", import.meta.url), `delete from public.rec_legend_catalog where name = 'Sammy Baugh';
insert into public.rec_legend_catalog (
  name,position,position_group,est_ovr,height,weight,hand,jersey_number,dev_trait,archetype,build_note,
  attributes,abilities,legend_tier,college,body_type,photo_url,game_scope,catalog_group
) values (
  ${q(sammy.name)},${q(sammy.position)},${q(sammy.position_group)},${sammy.est_ovr},${q(sammy.height)},${sammy.weight ?? "null"},${q(sammy.hand)},${sammy.jersey_number ?? "null"},
  ${q(sammy.dev_trait)},${q(sammy.archetype)},${q(sammy.build_note)},'${JSON.stringify(sammy.attributes).replaceAll("'","''")}'::jsonb,
  '${JSON.stringify(sammy.abilities).replaceAll("'","''")}'::jsonb,${q(sammy.legend_tier)},${q(sammy.college)},${q(sammy.body_type)},${q(sammy.photo_url)},'madden','current_catalog'
);
`);
const rows = additions.map((p) => `  (${q(p.name)},${q(p.position)},${q(p.position_group)},${p.est_ovr},${q(p.height)},${p.weight},${q(p.hand)},${p.jersey_number},'superstar',${q(p.archetype)},${q(p.build_note)},'${JSON.stringify(p.attributes).replaceAll("'","''")}'::jsonb,'${JSON.stringify(p.abilities).replaceAll("'","''")}'::jsonb,'legend',${q(p.college)},${q(p.body_type)},null,'madden','notable_addition')`).join(",\n");
const removalSql = removals.map(q).join(",\n  ");
fs.writeFileSync(migrationPath, `alter table public.rec_legend_catalog add column if not exists catalog_group text not null default 'current_catalog';
alter table public.rec_legend_catalog drop constraint if exists rec_legend_catalog_catalog_group_check;
alter table public.rec_legend_catalog add constraint rec_legend_catalog_catalog_group_check check (catalog_group in ('current_catalog','notable_addition'));

delete from public.rec_legend_catalog where name in (
  ${removalSql}
);

insert into public.rec_legend_catalog (
  name,position,position_group,est_ovr,height,weight,hand,jersey_number,dev_trait,archetype,build_note,
  attributes,abilities,legend_tier,college,body_type,photo_url,game_scope,catalog_group
) values
${rows}
on conflict (name,position) do update set
  position_group=excluded.position_group,est_ovr=excluded.est_ovr,height=excluded.height,weight=excluded.weight,
  hand=excluded.hand,jersey_number=excluded.jersey_number,dev_trait=excluded.dev_trait,archetype=excluded.archetype,
  build_note=excluded.build_note,attributes=excluded.attributes,abilities=excluded.abilities,legend_tier=excluded.legend_tier,
  college=excluded.college,body_type=excluded.body_type,photo_url=excluded.photo_url,game_scope=excluded.game_scope,
  catalog_group=excluded.catalog_group;
`);

fs.mkdirSync(batchDir, { recursive: true });
for (let index = 0; index < additions.length; index += 2) {
  const batchRows = additions.slice(index, index + 2).map((p) => `  (${q(p.name)},${q(p.position)},${q(p.position_group)},${p.est_ovr},${q(p.height)},${p.weight},${q(p.hand)},${p.jersey_number},'superstar',${q(p.archetype)},${q(p.build_note)},'${JSON.stringify(p.attributes).replaceAll("'","''")}'::jsonb,'${JSON.stringify(p.abilities).replaceAll("'","''")}'::jsonb,'legend',${q(p.college)},${q(p.body_type)},null,'madden','notable_addition')`).join(",\n");
  fs.writeFileSync(new URL(`${String(index / 2 + 1).padStart(2, "0")}.sql`, batchDir), `insert into public.rec_legend_catalog (
  name,position,position_group,est_ovr,height,weight,hand,jersey_number,dev_trait,archetype,build_note,
  attributes,abilities,legend_tier,college,body_type,photo_url,game_scope,catalog_group
) values
${batchRows}
on conflict (name,position) do update set
  position_group=excluded.position_group,est_ovr=excluded.est_ovr,height=excluded.height,weight=excluded.weight,
  hand=excluded.hand,jersey_number=excluded.jersey_number,dev_trait=excluded.dev_trait,archetype=excluded.archetype,
  build_note=excluded.build_note,attributes=excluded.attributes,abilities=excluded.abilities,legend_tier=excluded.legend_tier,
  college=excluded.college,body_type=excluded.body_type,photo_url=excluded.photo_url,game_scope=excluded.game_scope,
  catalog_group=excluded.catalog_group;
`);
}

const counts = Object.fromEntries(finalCatalog.reduce((map,p) => map.set(p.position,(map.get(p.position)??0)+1),new Map()));
console.log(JSON.stringify({ removed: catalog.length-retained.length, added:additions.length, total:finalCatalog.length, counts }, null, 2));
