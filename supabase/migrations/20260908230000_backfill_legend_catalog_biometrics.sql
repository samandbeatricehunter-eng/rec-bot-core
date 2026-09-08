-- Backfill height (inches)/weight (lbs) for the 296 rec_legend_catalog rows that were
-- missing both fields. The catalog spans three categories:
--   1. Real NFL players (Hall of Famers, notable veterans, draft busts) -- sourced from
--      real career/combine-listed measurements.
--   2. Real non-NFL celebrities/athletes appearing under stage or real names (wrestlers,
--      actors, musicians, other pro athletes) -- sourced from their real, documented
--      height/weight.
--   3. Fictional football-movie/TV characters -- sourced to the well-documented actor who
--      played the role where that's a reasonable stand-in, otherwise a sensible estimate
--      consistent with the character's listed position.
-- Every line below is tagged "sourced" (confident real/character-based identification) or
-- "estimated (no confident identity match)" (generic/ambiguous name with no verifiable
-- match; value derived from the row's listed Madden position archetype). 23 of the 296
-- rows are estimates; the remaining 273 are sourced.
-- Height is stored as a single integer of total inches (e.g. 6'2" = 74). Weight is lbs.

update rec_legend_catalog set height = 74, weight = 254 where id = '368de652-9fec-44c6-874c-d8c57a407dad'; -- Aaron Curry, sourced
update rec_legend_catalog set height = 78, weight = 285 where id = '4b675559-32b1-42ae-aac1-c2ecd59ea641'; -- Adam Dunn (MLB), sourced
update rec_legend_catalog set height = 70, weight = 189 where id = 'f3be24a1-8ab3-4c19-be4d-5b858f2d4c9f'; -- Adam "Pacman" Jones, sourced
update rec_legend_catalog set height = 71, weight = 200 where id = 'cbadca19-4e28-4048-8a5f-733294f9e71a'; -- Aeneas Williams, sourced
update rec_legend_catalog set height = 75, weight = 215 where id = '6cf4718f-43bd-46fa-9c7e-e2df433a74c9'; -- Akili Smith, sourced
update rec_legend_catalog set height = 72, weight = 165 where id = 'ee273435-114d-4e2e-9b2e-5a8d2132a2f4'; -- Allen Iverson (NBA), sourced
update rec_legend_catalog set height = 74, weight = 225 where id = 'e99e84f6-792a-40d7-a575-37acf147de23'; -- Alvin Mack, sourced
update rec_legend_catalog set height = 75, weight = 215 where id = '4956a763-7580-4c97-985d-5cab8f6a13f9'; -- Anders Lee (NHL), sourced
update rec_legend_catalog set height = 75, weight = 241 where id = 'd92ae445-5497-4ddb-886b-581997e46db3'; -- Andre Tippett, sourced
update rec_legend_catalog set height = 74, weight = 220 where id = '68115a91-1095-4429-9b55-19f3db175f74'; -- Andre Ware, sourced
update rec_legend_catalog set height = 76, weight = 225 where id = '6142693e-1ddb-46f5-be87-55533c38a167'; -- Anthony Edwards (NBA), sourced
update rec_legend_catalog set height = 74, weight = 210 where id = 'b61c8f36-c1b9-4c89-be24-68243fdbf6ed'; -- Antonio Cromartie, sourced
update rec_legend_catalog set height = 76, weight = 225 where id = 'be2ec333-2a4a-4d31-bfe8-f4b68f0ae3aa'; -- Archie Bradley (MLB), sourced
update rec_legend_catalog set height = 75, weight = 209 where id = '10a03011-4b17-495c-8a94-d92624c10fac'; -- Art Monk, sourced
update rec_legend_catalog set height = 72, weight = 180 where id = '5c0c43b5-cf79-4604-9dff-31974658a02f'; -- Aubrey Graham (Drake), sourced
update rec_legend_catalog set height = 77, weight = 235 where id = '7127a67a-d5b9-42eb-91f0-6cdab1c82820'; -- Aundray Bruce, sourced
update rec_legend_catalog set height = 75, weight = 255 where id = '6639466e-d651-4d86-8266-f76ef578504e'; -- Ben Watson, sourced
update rec_legend_catalog set height = 76, weight = 285 where id = '9f6185b6-8f69-4710-9ef5-397ce819adab'; -- Bill Goldberg (WWE), sourced
update rec_legend_catalog set height = 76, weight = 245 where id = '9db1ed7d-ea1f-4cd7-8609-c91bf49bff49'; -- Bill Romanowski, sourced
update rec_legend_catalog set height = 76, weight = 310 where id = 'd01855f3-2f64-487c-a95b-f892eedcca0b'; -- Billy Bob, estimated (no confident identity match)
update rec_legend_catalog set height = 72, weight = 202 where id = '7ac72a57-389a-41e9-bfee-84a1cd21e6a2'; -- Billy Cundiff, sourced
update rec_legend_catalog set height = 69, weight = 170 where id = '9d597e5a-fadb-4385-a98d-3e71a60ea5c1'; -- Billy "White Shoes" Johnson, sourced
update rec_legend_catalog set height = 71, weight = 207 where id = 'dc2f6c9a-9b7c-446f-88ca-ebb4e02538d6'; -- Blair Thomas, sourced
update rec_legend_catalog set height = 71, weight = 185 where id = '037dc4a1-eb24-43d5-a8e0-527d48008686'; -- Bob Hayes, sourced
update rec_legend_catalog set height = 70, weight = 220 where id = 'f53b00da-f193-439d-96f2-ac51ee5f8c5b'; -- Bobby Boucher (The Waterboy), estimated (character estimate consistent with MLB position)
update rec_legend_catalog set height = 73, weight = 190 where id = 'fde291c6-390f-469b-8fb6-651cad30fc1b'; -- Bobby Layne, sourced
update rec_legend_catalog set height = 69, weight = 200 where id = 'd781559e-03b3-47d8-a7d3-931fe13c8677'; -- Boobie Miles (Friday Night Lights, real basis), sourced
update rec_legend_catalog set height = 75, weight = 232 where id = '4f15a056-544e-4376-a7b8-8c9e30cd3f8a'; -- Brady Quinn, sourced
update rec_legend_catalog set height = 76, weight = 255 where id = '9f7deb02-91de-41ec-b049-273fdd5bd27c'; -- Brent Celek, sourced
update rec_legend_catalog set height = 70, weight = 185 where id = '579557f0-415c-4b6f-866e-9da5143e1173'; -- Brent Grimes, sourced
update rec_legend_catalog set height = 74, weight = 240 where id = '15e35784-5355-4d64-a3eb-f5d0ae6b50e4'; -- Brian Banks, sourced
update rec_legend_catalog set height = 76, weight = 250 where id = 'd31568c0-05ed-40be-b2a6-677e83350dde'; -- Brian Murphy, estimated (no confident identity match)
update rec_legend_catalog set height = 70, weight = 215 where id = 'd5c7493d-f153-47d5-a6b9-860352f993f6'; -- Brian Williams (HB), estimated (no confident identity match)
update rec_legend_catalog set height = 75, weight = 265 where id = 'd976cd0d-b5f9-4333-972e-2a55e80493d1'; -- Brock Lesnar, sourced
update rec_legend_catalog set height = 79, weight = 287 where id = 'c211a3f3-4202-4f42-975c-98b2e492c0e1'; -- Buck Buchanan, sourced
update rec_legend_catalog set height = 71, weight = 185 where id = 'c6a6e549-11b8-42d8-a8db-a6dbb411ca66'; -- Burt Reynolds, sourced
update rec_legend_catalog set height = 77, weight = 250 where id = '6cb79458-3d9b-4afb-a396-255929cbf420'; -- Cal Hubbard, sourced
update rec_legend_catalog set height = 76, weight = 168 where id = '4aa3e029-5c9f-4d3d-8a2f-c5782753bb0d'; -- Calvin Broadus (Snoop Dogg), sourced
update rec_legend_catalog set height = 74, weight = 210 where id = '65f62207-f2a4-42f2-b10a-0750d5a29f61'; -- Carl Crawford (MLB), sourced
update rec_legend_catalog set height = 78, weight = 247 where id = 'f499dff1-c806-44f8-84cc-01dda9f9d745'; -- Carl Eller, sourced
update rec_legend_catalog set height = 74, weight = 175 where id = '16dd69a7-ae34-4545-9227-840736d9ade5'; -- Carl Lewis, sourced
update rec_legend_catalog set height = 73, weight = 192 where id = '62733dea-bd6d-40e1-9168-e1f15651d781'; -- Chad Johnson (Ochocinco), sourced
update rec_legend_catalog set height = 77, weight = 315 where id = '55ed0234-cc58-4d9c-9c47-64b46d429246'; -- Charles Greane, estimated (no confident identity match)
update rec_legend_catalog set height = 75, weight = 202 where id = '2f4b0c11-bc1b-49d0-83e1-c4b32e86ae54'; -- Charles Rogers, sourced
update rec_legend_catalog set height = 74, weight = 220 where id = '1639b035-117b-4f8e-83fe-14f30cdde62c'; -- Charlie Batch, sourced
update rec_legend_catalog set height = 69, weight = 185 where id = '5ebe29c5-8248-4c38-910c-505bb7491647'; -- Charlie Tweeder (Varsity Blues, Scott Caan), sourced
update rec_legend_catalog set height = 74, weight = 190 where id = 'ca2f990c-3ad2-4b25-9b3a-07ff94258b25'; -- Charlie Ward, sourced
update rec_legend_catalog set height = 75, weight = 200 where id = 'dd5477ff-041a-498c-aebc-25427213a06d'; -- Chris Hemsworth, sourced
update rec_legend_catalog set height = 75, weight = 275 where id = '3e41ff34-28f9-4eb2-8267-db43db22a12b'; -- Chris Long, sourced
update rec_legend_catalog set height = 76, weight = 225 where id = 'fe4dc975-c311-44a1-9b20-2df29a041f5d'; -- Chris Weinke, sourced
update rec_legend_catalog set height = 69, weight = 180 where id = 'f75fb4dd-3da9-4979-864a-e271ed9c2620'; -- Christopher Bridges (Ludacris), sourced
update rec_legend_catalog set height = 75, weight = 252 where id = '1e6dc633-6688-4a93-b559-775aacd84950'; -- Claude Humphrey, sourced
update rec_legend_catalog set height = 75, weight = 255 where id = '9eb98e3b-b223-4ac1-bed9-6be176822410'; -- Clay Matthews III, sourced
update rec_legend_catalog set height = 72, weight = 195 where id = 'f3134796-bb61-4f4a-ad29-896d5c404a7b'; -- Clifford Franklin, estimated (no confident identity match)
update rec_legend_catalog set height = 71, weight = 170 where id = 'eef21898-fc59-49c5-958a-c1494cab0b88'; -- Clifford Smith (Method Man), sourced
update rec_legend_catalog set height = 75, weight = 205 where id = '4eddd3b7-0a24-4222-9564-4f4048d8e1ae'; -- Colt Brennan, sourced
update rec_legend_catalog set height = 75, weight = 265 where id = '233eeb13-b75a-47ee-8cea-c1c7ca392b31'; -- Conrad Dobler, sourced
update rec_legend_catalog set height = 69, weight = 160 where id = '44f2ebb3-bc07-401f-87b6-924e72c91f5f'; -- Cornell Haynes (Nelly), sourced
update rec_legend_catalog set height = 75, weight = 300 where id = 'ae488d08-2bd8-4db0-ab6e-6c9994040ff5'; -- Cortez Kennedy, sourced
update rec_legend_catalog set height = 70, weight = 188 where id = '1bd33a0f-5c8b-492c-823b-e770ab8dcd13'; -- Cortland Finnegan, sourced
update rec_legend_catalog set height = 76, weight = 268 where id = '3eaf8513-c7bc-44c1-bc4f-e61508225f92'; -- Courtney Brown, sourced
update rec_legend_catalog set height = 71, weight = 260 where id = '4d41acf2-f4fe-4989-a5a8-a0d6ba7add8b'; -- Craig "Ironhead" Heyward, sourced
update rec_legend_catalog set height = 73, weight = 265 where id = '8af26d02-a36d-4519-bde6-2aac10fc70ff'; -- Curley Culp, sourced
update rec_legend_catalog set height = 73, weight = 235 where id = 'e2e11373-7142-4631-afcc-f521b3b4570e'; -- Curtis Enis, sourced
update rec_legend_catalog set height = 71, weight = 210 where id = '8696e81f-d7e4-4a98-9843-272fd4676f5a'; -- Curtis Martin, sourced
update rec_legend_catalog set height = 85, weight = 347 where id = 'e2219ae5-d232-475b-be58-8f19652df3e5'; -- Dalip Singh (The Great Khali), sourced
update rec_legend_catalog set height = 80, weight = 230 where id = '8f057309-a6f0-4387-9c89-3dc6e0551bf4'; -- Dan McGwire, sourced
update rec_legend_catalog set height = 74, weight = 245 where id = '08dc1848-89e1-4a1b-a456-f343025a1536'; -- Daniel Bateman, estimated (no confident identity match)
update rec_legend_catalog set height = 68, weight = 200 where id = '60b665c4-97a0-453d-9d9d-059a75b6c4f6'; -- Danny Woodhead, sourced
update rec_legend_catalog set height = 73, weight = 205 where id = 'c6bfbea1-e6f8-4db4-9a23-a36f837d582c'; -- Danny Wuerffel, sourced
update rec_legend_catalog set height = 73, weight = 205 where id = '57bfc87c-1ed7-474c-a0ce-1048ce537124'; -- Darin Erstad (MLB), sourced
update rec_legend_catalog set height = 70, weight = 210 where id = '98ae3e3a-ccb4-4808-b797-9061a5ef2b58'; -- Darnell Jefferson, estimated (no confident identity match)
update rec_legend_catalog set height = 68, weight = 170 where id = '0f951016-7436-4af9-a513-4c04a76fdf87'; -- Darrell Green, sourced
update rec_legend_catalog set height = 73, weight = 219 where id = '97fed433-1171-429b-b859-d8b2218dc450'; -- Darren Woodson, sourced
update rec_legend_catalog set height = 76, weight = 290 where id = 'a73a0752-9e23-4b14-aed2-dae48be4bd1c'; -- Dave Bautista, sourced
update rec_legend_catalog set height = 78, weight = 220 where id = 'fd68e61b-0522-4067-874b-511378dd6d9a'; -- Dave Winfield (MLB), sourced
update rec_legend_catalog set height = 70, weight = 190 where id = 'a14053f8-00f4-4cd7-8a70-e7ae0ecc577e'; -- David Akers, sourced
update rec_legend_catalog set height = 75, weight = 205 where id = '23bf20db-cc94-4d99-b302-65a6b6aeff69'; -- David Klingler, sourced
update rec_legend_catalog set height = 75, weight = 210 where id = '400bf164-f142-4cae-9b3e-314bb7f3b6a7'; -- David Terrell, sourced
update rec_legend_catalog set height = 73, weight = 190 where id = 'fa3a6ea9-4fae-425d-93ea-4f3bf4786906'; -- Dean Cain, sourced
update rec_legend_catalog set height = 72, weight = 201 where id = '55f50cfa-0967-40b5-8cb8-21809fde7ff5'; -- Dee Milliner, sourced
update rec_legend_catalog set height = 74, weight = 245 where id = 'ecadd835-c150-42fb-ae7d-cd170daf6574'; -- Delanie Walker, sourced
update rec_legend_catalog set height = 74, weight = 220 where id = '46147bdf-d451-40c0-8023-7bb484675007'; -- Derek Starling, estimated (no confident identity match)
update rec_legend_catalog set height = 77, weight = 271 where id = '3cb63f84-8774-475e-a2e1-43be49a58a45'; -- Derrick Harvey, sourced
update rec_legend_catalog set height = 78, weight = 245 where id = '80e33c9f-aaa3-4ec8-9921-c15f65f225fe'; -- Dion Jordan, sourced
update rec_legend_catalog set height = 68, weight = 160 where id = '443ef3c1-ab07-4d8a-9c83-614ab3942fff'; -- Donald Glover, sourced
update rec_legend_catalog set height = 74, weight = 200 where id = 'ee9e3a65-bc7e-4a11-b5e8-f4bf4dffce07'; -- Donavan Tate (MLB), sourced
update rec_legend_catalog set height = 74, weight = 240 where id = 'c25b8f9e-1b12-4177-ac27-53a646d653ba'; -- Donovan McNabb, sourced
update rec_legend_catalog set height = 70, weight = 180 where id = 'a57f575d-c069-442c-9846-6187979fd4f2'; -- Doug Flutie, sourced
update rec_legend_catalog set height = 76, weight = 220 where id = 'a99826d2-c833-4ab1-b724-7ebca65d6fca'; -- Doug Williams, sourced
update rec_legend_catalog set height = 73, weight = 205 where id = '2a7c6cd7-c20a-40cb-b44b-64c4034c5b1d'; -- Duane Thomas, sourced
update rec_legend_catalog set height = 75, weight = 260 where id = 'b176ce50-4dd5-4968-927c-a216b47284a9'; -- Dustin Byfuglien (NHL), sourced
update rec_legend_catalog set height = 65, weight = 135 where id = '26a3b26c-1c6e-476d-892b-31db5f180816'; -- Dwayne Carter (Lil Wayne), sourced
update rec_legend_catalog set height = 77, weight = 260 where id = '6ab74dd2-e20f-469c-b786-ffae89c7aaaf'; -- Dwayne Johnson, sourced
update rec_legend_catalog set height = 70, weight = 200 where id = '294a8330-99fc-42fa-b2d2-719c4cd0b6b7'; -- Earl Megget, estimated (no confident identity match)
update rec_legend_catalog set height = 70, weight = 202 where id = '8a859c8f-3bc8-4eeb-ba0a-76bc300b6f02'; -- Earl Thomas, sourced
update rec_legend_catalog set height = 71, weight = 190 where id = '90d1486e-61e4-4e45-b1e5-6a5dac68800a'; -- Earl Wilkinson, estimated (no confident identity match)
update rec_legend_catalog set height = 75, weight = 220 where id = 'b2057f2b-4094-4898-9f26-60debdee22e0'; -- Ed O'Neill, sourced
update rec_legend_catalog set height = 74, weight = 190 where id = '6a48da6d-238b-453a-9a29-7787632841fc'; -- Elmo Wright, sourced
update rec_legend_catalog set height = 73, weight = 187 where id = '869f366f-bea9-4173-ae7f-eb9817194e47'; -- Emlen Tunnell, sourced
update rec_legend_catalog set height = 74, weight = 192 where id = 'e0aca3c4-a88c-4f9f-bc33-d079260cbdd0'; -- Emmitt Thomas, sourced
update rec_legend_catalog set height = 72, weight = 200 where id = 'cd4a2055-71f6-49c1-9adc-1e9e9f2f56e5'; -- Eric Crouch, sourced
update rec_legend_catalog set height = 73, weight = 200 where id = 'fa71243d-a3ee-412e-8cb4-65ae8ace1d95'; -- Eric Weddle, sourced
update rec_legend_catalog set height = 74, weight = 210 where id = 'a1951004-d4e5-4a14-acc0-4ed1aef7681e'; -- Ernie Davis, sourced
update rec_legend_catalog set height = 73, weight = 187 where id = '46218bc6-f7fa-45fe-8abe-839ed93c3984'; -- Everson Walls, sourced
update rec_legend_catalog set height = 74, weight = 210 where id = '73dec6a9-2b90-4aa1-944b-69ce49a5164e'; -- Flash Gordon, estimated (fictional character, position-consistent estimate)
update rec_legend_catalog set height = 72, weight = 200 where id = '5428a39e-285d-4140-8f82-b20928ba557b'; -- Forrest Gump, estimated (fictional character, position-consistent estimate)
update rec_legend_catalog set height = 72, weight = 190 where id = '3aa37ddf-7ef6-4a48-8681-168ada2c6259'; -- Fran Tarkenton, sourced
update rec_legend_catalog set height = 69, weight = 217 where id = 'b2e2dd69-79c3-4ca1-87ec-3b6f37dbcf5b'; -- Frank Gore, sourced
update rec_legend_catalog set height = 77, weight = 257 where id = '3c91cdb0-36b6-4019-8042-7a6c607c3f4c'; -- Frank Thomas (MLB), sourced
update rec_legend_catalog set height = 73, weight = 216 where id = '2080f113-12da-419b-a7e6-bc7c56db2aee'; -- Fred Jackson, sourced
update rec_legend_catalog set height = 75, weight = 210 where id = 'f99c22ad-5673-4e5d-acac-aff024df5f12'; -- Fred Williamson, sourced
update rec_legend_catalog set height = 72, weight = 195 where id = '2a0ece00-694a-4af5-9166-4d403fefd833'; -- Freddie Mitchell, sourced
update rec_legend_catalog set height = 72, weight = 275 where id = 'a9940806-a6bf-46a9-8062-cbdc54759c11'; -- Gable Steveson, sourced
update rec_legend_catalog set height = 78, weight = 294 where id = '39f9a30c-d2bf-4e6d-b089-ec761e01a639'; -- Gary Zimmerman, sourced
update rec_legend_catalog set height = 77, weight = 255 where id = '8d411e36-edd3-42f8-a9b2-62c2704b5fd6'; -- Gene Upshaw, sourced
update rec_legend_catalog set height = 74, weight = 215 where id = '0c6e84cf-bf7f-4740-8ca6-6247d7ed4b4b'; -- George Blanda, sourced
update rec_legend_catalog set height = 83, weight = 243 where id = 'c9e9c2f5-c8ed-4bba-b3db-0c4b05e0021a'; -- Giannis Antetokounmpo (NBA), sourced
update rec_legend_catalog set height = 74, weight = 213 where id = 'd193dc44-abeb-4d5f-ad26-7ed752db11a3'; -- Gino Torretta, sourced
update rec_legend_catalog set height = 77, weight = 332 where id = 'bea5f962-ea13-49a5-bcee-88a4003d8dcf'; -- Greg Robinson, sourced
update rec_legend_catalog set height = 77, weight = 256 where id = '01707061-f16f-4520-ac1c-a2fd56c02853'; -- Heath Miller, sourced
update rec_legend_catalog set height = 74, weight = 217 where id = '8633e65c-c61d-4785-835f-106fed608ae9'; -- Heath Shuler, sourced
update rec_legend_catalog set height = 72, weight = 205 where id = 'a75213fa-1122-4c78-a277-fcd326513e65'; -- Hines Ward, sourced
update rec_legend_catalog set height = 75, weight = 220 where id = '78a4cd4f-2cfe-4fe1-ba63-77b65cf35132'; -- Idris Elba, sourced
update rec_legend_catalog set height = 70, weight = 200 where id = '987ef775-6e74-4cdf-a2fc-aed11856b4b4'; -- Ilona Maher (rugby), sourced
update rec_legend_catalog set height = 78, weight = 350 where id = '977811dc-e332-4bed-9985-f57b4e3afc57'; -- Isaiah Wilson, sourced
update rec_legend_catalog set height = 77, weight = 288 where id = 'b6f0b042-d7f7-44af-8f7a-45375a930742'; -- J.J. Watt, sourced
update rec_legend_catalog set height = 74, weight = 215 where id = '2d6c6301-5bd6-4d69-b0fc-6d8f0d37f0ff'; -- Jack Rooney, estimated (no confident identity match)
update rec_legend_catalog set height = 71, weight = 195 where id = '2f6164db-97e7-4e7d-bd6c-c6ef1b9658ef'; -- Jackie Robinson, sourced
update rec_legend_catalog set height = 74, weight = 205 where id = 'e267337d-04d9-4585-87d3-fbad9ef83692'; -- Jake Plummer, sourced
update rec_legend_catalog set height = 76, weight = 205 where id = '5e00b3d1-0096-4670-8a66-0fc8d47d1369'; -- Jalen Suggs (NBA), sourced
update rec_legend_catalog set height = 78, weight = 260 where id = 'cee7b1db-d6d9-4b87-876a-ffecddf9e064'; -- Jamaal Anderson, sourced
update rec_legend_catalog set height = 72, weight = 199 where id = 'ed6031fd-dab6-485d-be13-6bf78701462a'; -- Jamaal Charles, sourced
update rec_legend_catalog set height = 78, weight = 260 where id = '96124440-ec9c-4b04-99a8-ad1d44d50c84'; -- JaMarcus Russell, sourced
update rec_legend_catalog set height = 72, weight = 242 where id = 'a843b5f2-75db-436d-9ed7-be7723e76617'; -- James Harrison, sourced
update rec_legend_catalog set height = 78, weight = 270 where id = 'd5e038ff-5274-49a3-84bc-3e51a69e484b'; -- Jared Allen, sourced
update rec_legend_catalog set height = 75, weight = 205 where id = 'afca2327-aa2d-4ff0-9853-81c956903a3f'; -- Jason Elam, sourced
update rec_legend_catalog set height = 76, weight = 236 where id = 'fd86f1da-3969-4281-9356-5f20bdd34533'; -- Jason Momoa, sourced
update rec_legend_catalog set height = 77, weight = 309 where id = 'd5863d6b-b33e-423d-9da6-c126eb6c8d1b'; -- Jason Smith, sourced
update rec_legend_catalog set height = 74, weight = 220 where id = 'f4a1575c-d295-4329-a083-e91e72808c67'; -- Jason White, sourced
update rec_legend_catalog set height = 76, weight = 220 where id = 'e915ed06-4ae5-4458-b800-b8175136160b'; -- Jeff Francoeur (MLB), sourced
update rec_legend_catalog set height = 76, weight = 220 where id = '873ec34c-9e96-4cd1-95e7-d6171430959e'; -- Jeff George, sourced
update rec_legend_catalog set height = 77, weight = 225 where id = '4ac095f0-7529-434d-a70e-c7e1ad80c501'; -- Jeff Samardzija (MLB), sourced
update rec_legend_catalog set height = 74, weight = 295 where id = '467f584d-8493-45b0-a462-1beaba85b8d7'; -- Jeff Saturday, sourced
update rec_legend_catalog set height = 75, weight = 220 where id = '866cbe15-0c4c-4dc4-bb27-a75586687493'; -- Jerrel Wilson, sourced
update rec_legend_catalog set height = 77, weight = 212 where id = '653759e5-99bc-4a32-8f81-30e453f67c45'; -- Jim Everett, sourced
update rec_legend_catalog set height = 73, weight = 190 where id = 'e5a9f527-b514-4df0-935b-8df13375a098'; -- Jim McMahon, sourced
update rec_legend_catalog set height = 71, weight = 170 where id = '2595eeba-0b1a-4aa8-bd73-54f731a39577'; -- Jimmy Dix (The Last Boy Scout, Damon Wayans), sourced
update rec_legend_catalog set height = 74, weight = 187 where id = 'c09034f5-8d34-4f3f-a557-424f617e5af8'; -- Jimmy Johnson (HOF CB), sourced
update rec_legend_catalog set height = 74, weight = 215 where id = 'aa51af98-ecde-4ec3-b952-0fe2fedef915'; -- Joe Kane, estimated (fictional character, uncertain film identification)
update rec_legend_catalog set height = 75, weight = 220 where id = 'f741409a-748b-4703-b78e-58ce8264c3cf'; -- Joe Kingman, estimated (fictional character, uncertain film identification)
update rec_legend_catalog set height = 77, weight = 220 where id = 'fba7999d-b368-4679-b2d7-2f10907c6136'; -- Joe Mauer (MLB), sourced
update rec_legend_catalog set height = 73, weight = 205 where id = '9f278f1c-fc69-40bf-910e-8c5e60364df6'; -- Joe Pendleton (Heaven Can Wait, Warren Beatty), sourced
update rec_legend_catalog set height = 84, weight = 280 where id = '672a6d38-cfae-4538-beb2-c44823cbea82'; -- Joel Embiid (NBA), sourced
update rec_legend_catalog set height = 73, weight = 251 where id = '1a873cbd-74f3-40de-b2cd-3818fec2987d'; -- John Cena, sourced
update rec_legend_catalog set height = 77, weight = 205 where id = '561212ba-21d0-4e1d-a740-1af7cdf5d83a'; -- John Havlicek (NBA), sourced
update rec_legend_catalog set height = 74, weight = 210 where id = '77b183b1-e68d-45db-a5a5-4937ef7aedc1'; -- John Henry Johnson, sourced
update rec_legend_catalog set height = 71, weight = 188 where id = '0ba23a09-ace3-40c7-9dfa-0085507f156c'; -- John Ross, sourced
update rec_legend_catalog set height = 74, weight = 191 where id = 'fa678ddc-1c81-4207-9f0f-68c812611b4c'; -- John Stallworth, sourced
update rec_legend_catalog set height = 72, weight = 200 where id = '15347fc7-f85d-447f-9fdd-acb860927f21'; -- Johnny Manziel, sourced
update rec_legend_catalog set height = 77, weight = 265 where id = '993f92fd-9568-47bd-938b-b487f7faa2ab'; -- Jonah Lomu, sourced
update rec_legend_catalog set height = 75, weight = 190 where id = 'a307a9ac-7a57-47cb-9469-18308df3db17'; -- Jonathan Moxon (Varsity Blues, James Van Der Beek), sourced
update rec_legend_catalog set height = 73, weight = 215 where id = 'a7b7aafb-2442-462f-842a-221b2f60882a'; -- Josh Cribbs, sourced
update rec_legend_catalog set height = 76, weight = 220 where id = 'd551349e-26a7-4eb6-b2a8-68261a780443'; -- Josh McCown, sourced
update rec_legend_catalog set height = 76, weight = 226 where id = 'fb870088-b77a-4ce5-a76e-71401e556ab0'; -- Josh Rosen, sourced
update rec_legend_catalog set height = 70, weight = 205 where id = '98dc3500-f2c6-4d05-8c68-9f7200b86ff1'; -- Julian Washington, estimated (no confident identity match)
update rec_legend_catalog set height = 78, weight = 350 where id = 'bc9f8eb3-4e2c-4159-9c10-39ba91f6fb7d'; -- Jumbo Fumiko, estimated (no confident identity match)
update rec_legend_catalog set height = 73, weight = 175 where id = '33fc4a7a-d363-4052-be9b-7b04be9c97fb'; -- Justin Gatlin, sourced
update rec_legend_catalog set height = 72, weight = 202 where id = 'e2225b79-499d-4b45-aa1d-ff30e2ccb1fe'; -- Justin Gilbert, sourced
update rec_legend_catalog set height = 73, weight = 183 where id = '4269e755-4697-4e3b-aae4-d44dac9203f4'; -- Justin Tucker, sourced
update rec_legend_catalog set height = 75, weight = 212 where id = '20704d6c-461c-4833-ba22-f1a5d69070a0'; -- Ken Anderson, sourced
update rec_legend_catalog set height = 75, weight = 198 where id = '37ea3c9e-d343-4f8d-9142-1b151c3ef5cb'; -- Ken Houston, sourced
update rec_legend_catalog set height = 75, weight = 247 where id = 'f7db037c-00e2-449a-9f81-044e9152b95b'; -- Kevin Greene, sourced
update rec_legend_catalog set height = 64, weight = 170 where id = '7671fa1f-2456-4f33-97ab-42051cc998ee'; -- Kevin Hart, sourced
update rec_legend_catalog set height = 75, weight = 215 where id = '471807f8-9446-4138-b962-c5851f1a9994'; -- Kevin White, sourced
update rec_legend_catalog set height = 77, weight = 311 where id = '79e4af49-277d-4526-8aa5-86d3a6a41fc8'; -- Kevin Williams, sourced
update rec_legend_catalog set height = 71, weight = 222 where id = 'b805d2f8-36e2-42c5-87e0-1e721ba04e04'; -- Ki-Jana Carter, sourced
update rec_legend_catalog set height = 75, weight = 215 where id = '3b791b36-4dd6-4f65-b349-7cb287694f4e'; -- Kirk Gibson (MLB), sourced
update rec_legend_catalog set height = 73, weight = 218 where id = 'c4d3e840-560b-4bc4-aa7d-b80ee703b229'; -- Kordell Stewart, sourced
update rec_legend_catalog set height = 74, weight = 214 where id = '2f5c7255-6657-4508-93ea-2ec14117d948'; -- Kurt Warner, sourced
update rec_legend_catalog set height = 78, weight = 260 where id = 'da845592-dd3b-4168-9d24-9c789b8f4411'; -- Kyle Brady, sourced
update rec_legend_catalog set height = 76, weight = 273 where id = 'a0c3174b-3eda-4333-b799-a4a7cb1e34fd'; -- Kyle Vanden Bosch, sourced
update rec_legend_catalog set height = 73, weight = 195 where id = '5f79349f-a711-47a3-8af2-117e9d75894e'; -- Lance Harbor (Varsity Blues, Paul Walker), sourced
update rec_legend_catalog set height = 72, weight = 190 where id = 'f179ade5-ee05-4ddb-b670-0b73319cdeaf'; -- Larry Wilson, sourced
update rec_legend_catalog set height = 72, weight = 219 where id = '61de7cf2-3975-4f28-aafb-cb2c798dc707'; -- Lawrence Phillips, sourced
update rec_legend_catalog set height = 75, weight = 265 where id = '53b092b5-6d5c-4e37-966e-654ad5d86847'; -- Leati Anoa'i (Roman Reigns), sourced
update rec_legend_catalog set height = 81, weight = 250 where id = '55b4a63d-c075-42b1-b914-f0849cadf9b3'; -- LeBron James (NBA), sourced
update rec_legend_catalog set height = 68, weight = 195 where id = 'd3304506-5bef-46ba-801f-9222602d4786'; -- Leon Washington, sourced
update rec_legend_catalog set height = 73, weight = 242 where id = '5cc10f51-25d4-4336-8dca-f238073d6498'; -- Lofa Tatupu, sourced
update rec_legend_catalog set height = 70, weight = 245 where id = '813b5933-3b1f-4d09-a3ad-7b4405b88423'; -- London Fletcher, sourced
update rec_legend_catalog set height = 74, weight = 203 where id = '14af362c-e9a5-459c-af71-897967b2ce46'; -- Louis Rees-Zammit (rugby), sourced
update rec_legend_catalog set height = 78, weight = 306 where id = 'e9e3643e-f09c-412e-b3a1-6eccf47da89f'; -- Luke Joeckel, sourced
update rec_legend_catalog set height = 71, weight = 180 where id = 'a62cb289-6d5a-42cc-a363-6315fa347abd'; -- Lynn Swann, sourced
update rec_legend_catalog set height = 74, weight = 180 where id = 'be16983f-21d7-4800-bec1-8cc4d3ec5ac8'; -- Mahershala Ali, sourced
update rec_legend_catalog set height = 73, weight = 180 where id = 'ee539e7b-aece-43f4-9be3-9424e67ff334'; -- Major Harris, sourced
update rec_legend_catalog set height = 75, weight = 230 where id = '6da73a1b-c443-46cb-9e47-2f0ef72c58a4'; -- Marcus Dupree, sourced
update rec_legend_catalog set height = 71, weight = 220 where id = '12c614c6-e0c5-4645-8f8a-9bb43c49fe45'; -- Marion Barber III, sourced
update rec_legend_catalog set height = 76, weight = 245 where id = '508596a6-c051-4a25-8070-50b313357cc9'; -- Mark Bavaro, sourced
update rec_legend_catalog set height = 77, weight = 270 where id = '87ecdeb3-69b1-4f6d-a4be-c8bf43b21a85'; -- Mark Gastineau, sourced
update rec_legend_catalog set height = 72, weight = 190 where id = 'c8ed9752-1384-401f-a5a7-5b38fa32cf55'; -- Mark Harmon, sourced
update rec_legend_catalog set height = 75, weight = 205 where id = '7d833c6a-d94b-493c-ae91-1c51ea6e555f'; -- Marquette King, sourced
update rec_legend_catalog set height = 75, weight = 305 where id = 'e79cdf87-b2bf-442f-ab56-9196ff82e099'; -- Marshal Yanda, sourced
update rec_legend_catalog set height = 71, weight = 215 where id = 'b63b9168-2e6f-42b3-ac34-59b502242286'; -- Marshawn Lynch, sourced
update rec_legend_catalog set height = 72, weight = 200 where id = 'dbe0c536-f66a-4bda-bb47-9340cfaa4f04'; -- Matt Barnes, estimated (ambiguous identity -- multiple real people share the name)
update rec_legend_catalog set height = 77, weight = 225 where id = '13d83643-4b8f-48c4-823c-34ad98139219'; -- Matt Leinart, sourced
update rec_legend_catalog set height = 73, weight = 197 where id = '44288ace-cfb9-443c-873d-4af7d035c5a5'; -- Matt Stover, sourced
update rec_legend_catalog set height = 72, weight = 195 where id = 'cdcbfa60-d7b2-4b66-b05c-84e4c33ab558'; -- Matthew Jones, estimated (no confident identity match)
update rec_legend_catalog set height = 77, weight = 270 where id = '8c588f94-c979-44de-8de0-975b21b999e0'; -- Merlin Olsen, sourced
update rec_legend_catalog set height = 72, weight = 190 where id = '5f7d307c-9e1b-42bf-95fe-2a4138241700'; -- Mike Vanderjagt, sourced
update rec_legend_catalog set height = 75, weight = 215 where id = '7db75cc3-cd1c-45ba-98e6-4d638c0dd9e9'; -- Miles Austin, sourced
update rec_legend_catalog set height = 74, weight = 210 where id = '5115c8eb-1996-4990-9264-bed36d7efdce'; -- Mohamed Sanu, sourced
update rec_legend_catalog set height = 69, weight = 180 where id = '2ed65854-4808-477e-a9e3-1e670b987438'; -- Nate Robinson (NBA), sourced
update rec_legend_catalog set height = 76, weight = 305 where id = 'cdd1b5a1-7866-409e-adae-63a4b69339df'; -- Nick Mangold, sourced
update rec_legend_catalog set height = 71, weight = 190 where id = '019cfa67-b71c-435a-8220-9458497be731'; -- Nigel Gruff, estimated (no confident identity match)
update rec_legend_catalog set height = 74, weight = 210 where id = 'da70645d-6af5-48e6-8860-f10892ffa569'; -- Nnamdi Asomugha, sourced
update rec_legend_catalog set height = 70, weight = 200 where id = 'b2cad59d-c072-40cb-bed1-90c70a674b24'; -- O'Shea Jackson (Ice Cube), sourced
update rec_legend_catalog set height = 74, weight = 292 where id = '40ec886b-f2d0-4b81-b826-2ce0072535a2'; -- Olin Kreutz, sourced
update rec_legend_catalog set height = 75, weight = 205 where id = '33ffa017-0bec-4349-9e0e-c4e415f217af'; -- Otis Taylor, sourced
update rec_legend_catalog set height = 74, weight = 232 where id = '81655ce9-5ef4-4059-8fd0-495e919da289'; -- Ozzie Newsome, sourced
update rec_legend_catalog set height = 73, weight = 233 where id = '39832573-d31a-4179-9af5-51b85d62c939'; -- Pat McAfee, sourced
update rec_legend_catalog set height = 74, weight = 200 where id = 'b733695e-d7d9-4ecc-8a9b-0b98d415f5a0'; -- Paul Blake (Necessary Roughness, Scott Bakula), sourced
update rec_legend_catalog set height = 71, weight = 195 where id = 'fb11a491-f5f7-4550-8f27-59c039aff945'; -- Paul Crewe (The Longest Yard, Burt Reynolds), sourced
update rec_legend_catalog set height = 72, weight = 188 where id = 'a0e8df88-ce87-4168-94ae-a593825f9c47'; -- Paul Warfield, sourced
update rec_legend_catalog set height = 79, weight = 244 where id = '5e7b8d81-042a-4b3d-85d9-f1ceed557340'; -- Paxton Lynch, sourced
update rec_legend_catalog set height = 72, weight = 194 where id = '72a0d43a-fcad-4ec3-82c5-8968e45583d6'; -- Peter Warrick, sourced
update rec_legend_catalog set height = 74, weight = 250 where id = '96eed18c-6255-4f8e-b650-06504b0ef8c8'; -- Peyton Hillis, sourced
update rec_legend_catalog set height = 71, weight = 190 where id = 'e31f7281-6008-496d-be73-f46c3ec64056'; -- Phil Dawson, sourced
update rec_legend_catalog set height = 77, weight = 228 where id = '03aaa9e5-b31c-4e6e-afe0-5d1905f19f8c'; -- Philip Rivers, sourced
update rec_legend_catalog set height = 69, weight = 213 where id = '6f4abd8d-f33d-475f-89b6-096bc145a9f4'; -- Priest Holmes, sourced
update rec_legend_catalog set height = 73, weight = 215 where id = '5e326038-edb8-4551-ac7d-079ac6de5a08'; -- Rashaan Salaam, sourced
update rec_legend_catalog set height = 74, weight = 195 where id = '9a1104c4-66ce-4e24-aaad-b104dfa1b603'; -- Rashaun Woods, sourced
update rec_legend_catalog set height = 75, weight = 217 where id = '93b4dab7-37ae-4a76-a42b-485803884dee'; -- Reggie Williams (WR, Jaguars), sourced
update rec_legend_catalog set height = 77, weight = 265 where id = '617cdf3c-3ed6-4785-b6a2-9110183ee4e0'; -- Richard Dent, sourced
update rec_legend_catalog set height = 75, weight = 195 where id = '6134519b-cdab-43e0-b7ce-a057b1a7fb9e'; -- Richard Sherman, sourced
update rec_legend_catalog set height = 74, weight = 218 where id = 'cacdba32-6c2c-4d32-be8f-4714141260c2'; -- Rick Mirer, sourced
update rec_legend_catalog set height = 78, weight = 253 where id = '59829008-3d39-402e-baf4-cfa3ad0fc65c'; -- Rickey Dudley, sourced
update rec_legend_catalog set height = 74, weight = 243 where id = '755a7bbb-4ce2-421f-ac25-0c7624bf6df4'; -- Rickey Jackson, sourced
update rec_legend_catalog set height = 74, weight = 210 where id = '51e706ae-6a21-40c8-87f1-70472f0e7690'; -- Ricky Jerret (Ballers, John David Washington), sourced
update rec_legend_catalog set height = 79, weight = 325 where id = '7a88f7ac-2887-4d3f-9159-34fb963114be'; -- Robert Gallery, sourced
update rec_legend_catalog set height = 74, weight = 217 where id = '3795d6a7-2db0-4767-8828-a6a0e2d6c19c'; -- Robert Griffin III, sourced
update rec_legend_catalog set height = 73, weight = 205 where id = '9ff85670-0706-4ffa-93e8-233ed7da1fba'; -- Roberto Aguayo, sourced
update rec_legend_catalog set height = 71, weight = 195 where id = 'bf7bfd8b-7f32-43e1-bc96-e53c53a8bbec'; -- Rod Tidwell (Jerry Maguire, Cuba Gooding Jr.), sourced
update rec_legend_catalog set height = 70, weight = 250 where id = 'daa835c8-4ab0-4183-8e49-26c28e71d778'; -- Ron Dayne, sourced
update rec_legend_catalog set height = 70, weight = 184 where id = 'e2b25f18-d412-4df4-91db-20cbbbbbb3cc'; -- Ronde Barber, sourced
update rec_legend_catalog set height = 66, weight = 165 where id = 'a812f413-6204-42a7-9adb-50f90fe28bde'; -- Rudy Ruettiger, sourced
update rec_legend_catalog set height = 74, weight = 223 where id = '8614461c-8494-4630-a44a-8c512245f47f'; -- Ryan Fitzpatrick, sourced
update rec_legend_catalog set height = 77, weight = 234 where id = '8504fe94-1fad-47d6-92c0-8af3e07c6276'; -- Ryan Leaf, sourced
update rec_legend_catalog set height = 74, weight = 250 where id = 'e8c75900-55bf-476a-8a1f-289df2c943e4'; -- Sebastian Janikowski, sourced
update rec_legend_catalog set height = 73, weight = 215 where id = '4f3d5570-f4e4-4283-929f-0cae41bf0d1b'; -- Shane Falco (The Replacements, Keanu Reeves), sourced
update rec_legend_catalog set height = 85, weight = 325 where id = '7f24a724-c3e9-4d20-9aba-f71775c48603'; -- Shaquille O'Neal (NBA), sourced
update rec_legend_catalog set height = 71, weight = 218 where id = '54fd71ad-3bdf-40e7-8b76-b7b71874a8c9'; -- Shaun Alexander, sourced
update rec_legend_catalog set height = 72, weight = 195 where id = '952a2b80-01b8-442d-8f63-09488fee3cce'; -- Sid Luckman, sourced
update rec_legend_catalog set height = 77, weight = 268 where id = '7c7c4b93-bef6-4909-90c8-598cb51d683d'; -- Simeon Rice, sourced
update rec_legend_catalog set height = 72, weight = 203 where id = '3839a1a0-c70a-46ae-b65d-b63f8de327b2'; -- Sonny Jurgensen, sourced
update rec_legend_catalog set height = 72, weight = 190 where id = '57dc378e-38bf-43b9-aef4-f700b6fb4bf2'; -- Spencer James (All American), sourced
update rec_legend_catalog set height = 71, weight = 190 where id = 'da2af645-9271-4c60-837e-922fd6a92851'; -- Stefen Djordjevic, estimated (no confident identity match)
update rec_legend_catalog set height = 73, weight = 205 where id = 'd8b494a0-8f22-4879-a722-3a9e485f5ea0'; -- Sterling Sharpe, sourced
update rec_legend_catalog set height = 74, weight = 252 where id = '53f80b21-fc82-43ea-86dc-055144d2ab86'; -- Steve Austin ("Stone Cold", WWE), sourced
update rec_legend_catalog set height = 76, weight = 290 where id = '0e59dd57-0def-4fb8-ac0d-ea3cee2998e2'; -- Steve Emtman, sourced
update rec_legend_catalog set height = 69, weight = 185 where id = 'ea4b7382-d4cd-4d94-8a1e-910fc61cbe29'; -- Steve Smith Sr., sourced
update rec_legend_catalog set height = 74, weight = 235 where id = '6a8925ce-1816-4453-8c7a-b3af49eb625e'; -- Steven Jackson, sourced
update rec_legend_catalog set height = 77, weight = 220 where id = 'd6749bd0-eb33-4939-a25b-0366c5beccb7'; -- Tauheed Epps (2 Chainz), sourced
update rec_legend_catalog set height = 68, weight = 165 where id = '314acc16-8b6c-4383-acfc-9a6ed00c1865'; -- Taylor Gabriel, sourced
update rec_legend_catalog set height = 74, weight = 245 where id = '3bc8b97f-8aa7-4418-90a1-6637d08e5970'; -- Terry Crews, sourced
update rec_legend_catalog set height = 70, weight = 200 where id = 'cfb25556-7875-4511-aa23-3ec3e76b0a70'; -- Tiki Barber, sourced
update rec_legend_catalog set height = 72, weight = 195 where id = '0621bb5a-8948-4bea-bca5-14689519091d'; -- Tim Brown, sourced
update rec_legend_catalog set height = 76, weight = 224 where id = '1256fce5-1c79-461e-90c7-5627822b7cae'; -- Tim Couch, sourced
update rec_legend_catalog set height = 72, weight = 210 where id = '326b78b5-f2c1-4311-b7f8-76b4fc2aa947'; -- Tim Riggins (Friday Night Lights, Taylor Kitsch), sourced
update rec_legend_catalog set height = 75, weight = 236 where id = '2d34fc4d-ee88-4d24-8585-e8e9d3c6b859'; -- Tim Tebow, sourced
update rec_legend_catalog set height = 74, weight = 205 where id = 'f8654f32-6ea6-4d06-b467-a74a6987feb3'; -- Todd Helton (MLB), sourced
update rec_legend_catalog set height = 76, weight = 210 where id = '5effcaa6-aee0-4571-a187-fb950377a7e9'; -- Todd Marinovich, sourced
update rec_legend_catalog set height = 75, weight = 285 where id = '8378d7fa-7861-416b-b1ba-7e0e66a46a73'; -- Tom Nalen, sourced
update rec_legend_catalog set height = 73, weight = 205 where id = '72ed14fb-71ba-4567-a632-28f630a330e4'; -- Tommie Frazier, sourced
update rec_legend_catalog set height = 78, weight = 315 where id = '47e438ab-3d97-4b68-8b05-7723dffc5a9c'; -- Tony Mandarich, sourced
update rec_legend_catalog set height = 75, weight = 340 where id = 'd2ce45e6-f749-4915-9206-2318aef63ac1'; -- Tony Siragusa, sourced
update rec_legend_catalog set height = 69, weight = 224 where id = 'bbde7da1-f9f9-4d73-baec-7e9c1369f6ff'; -- Trent Richardson, sourced
update rec_legend_catalog set height = 72, weight = 215 where id = '79bd3f46-4b06-42ea-9ac5-12271cba8eb8'; -- Troy Smith, sourced
update rec_legend_catalog set height = 73, weight = 188 where id = '5817e6b5-3a76-40b5-9c6a-c2204118dd74'; -- Troy Williamson, sourced
update rec_legend_catalog set height = 72, weight = 175 where id = 'd6058795-0166-4abf-81fc-36929c80ff92'; -- Ty Detmer, sourced
update rec_legend_catalog set height = 77, weight = 207 where id = 'c3d6862b-2a42-4e03-b2bd-76d1312f9a39'; -- Usain Bolt, sourced
update rec_legend_catalog set height = 75, weight = 266 where id = 'cd3c0d59-f913-4c88-a736-aaff77a61238'; -- Vernon Gholston, sourced
update rec_legend_catalog set height = 75, weight = 260 where id = '1728ff2f-44e7-4116-a640-2680f54c7856'; -- Vernon Littlefield, estimated (no confident identity match)
update rec_legend_catalog set height = 72, weight = 190 where id = 'eb5e5493-af8e-4024-b7e7-d0136540b308'; -- Vince Howard (Friday Night Lights TV, Michael B. Jordan), sourced
update rec_legend_catalog set height = 74, weight = 195 where id = 'ce84df94-c636-4226-a2ea-eff4b6802418'; -- Vince Papale (real Eagles player / Invincible), sourced
update rec_legend_catalog set height = 77, weight = 235 where id = '19f26fed-db16-43ad-931a-d461b7c36abf'; -- Vinny Testaverde, sourced
update rec_legend_catalog set height = 77, weight = 325 where id = '6f1b9d27-5a3e-4328-b346-7b1b2abcb693'; -- Walter Jones, sourced
update rec_legend_catalog set height = 69, weight = 185 where id = 'd2a7debf-9f5e-410d-9759-2e0b6d39d335'; -- Wes Welker, sourced
update rec_legend_catalog set height = 75, weight = 315 where id = '0d12bef4-7820-4499-98cd-4087b91c6f4c'; -- Will Shields, sourced
update rec_legend_catalog set height = 77, weight = 340 where id = 'fb3d53cd-103e-452e-b507-4c38a2f8cc8b'; -- Willie Anderson, sourced
update rec_legend_catalog set height = 71, weight = 210 where id = '840d873c-cc9b-4110-8114-1bde6cc00766'; -- Willie Beamen (Any Given Sunday, Jamie Foxx), sourced
update rec_legend_catalog set height = 85, weight = 275 where id = '60d2e670-d342-401c-8fb4-6956f81e027f'; -- Wilt Chamberlain (NBA), sourced
update rec_legend_catalog set height = 72, weight = 192 where id = '7343e683-6915-4283-a986-60957d7fc00a'; -- Y.A. Tittle, sourced
update rec_legend_catalog set height = 71, weight = 235 where id = 'b3168b54-2765-4e15-bbea-e92a300fea57'; -- Zach Thomas, sourced
update rec_legend_catalog set height = 76, weight = 315 where id = 'a174755e-5d2e-4ea6-ae4c-1937dfe952a1'; -- Zack Martin, sourced
update rec_legend_catalog set height = 81, weight = 250 where id = '1fb602a4-de19-42c4-95d0-608e4fc9c5e7'; -- Zdeno Chara (NHL), sourced
update rec_legend_catalog set height = 78, weight = 284 where id = '5d988d7b-e8a2-442b-97be-99eb21213bf6'; -- Zion Williamson (NBA), sourced
