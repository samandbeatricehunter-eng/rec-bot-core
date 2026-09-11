-- Backfill rec_legend_catalog dominant hand, jersey number, and college.
-- Hand: only Left flips are written. Existing Right stays unless a source
-- documents left-handed throwing or left-footed kicking. Remaining Right
-- values are the catalog default, left unchanged when no left-hand evidence.
-- Jersey/college: filled only from football (or baseball) Wikipedia infoboxes.
-- 387 rows updated of 597 catalog entries.

update rec_legend_catalog set college = 'Wake Forest' where id = '368de652-9fec-44c6-874c-d8c57a407dad'; -- Aaron Curry (ROLB), Wake Forest; https://en.wikipedia.org/wiki/Aaron_Curry_(American_football)
update rec_legend_catalog set jersey_number = 24, college = 'West Virginia' where id = 'f3be24a1-8ab3-4c19-be4d-5b858f2d4c9f'; -- Adam Jones (CB), #24, West Virginia; https://en.wikipedia.org/wiki/Adam_Jones_(American_football)
update rec_legend_catalog set college = 'Oklahoma' where id = '9969fc7b-6f48-4301-a0db-7b1a6e4f0559'; -- Adrian Peterson (HB), Oklahoma; https://en.wikipedia.org/wiki/Adrian_Peterson
update rec_legend_catalog set jersey_number = 35, college = 'Southern' where id = 'cbadca19-4e28-4048-8a5f-733294f9e71a'; -- Aeneas Williams (CB), #35, Southern; https://en.wikipedia.org/wiki/Aeneas_Williams
update rec_legend_catalog set jersey_number = 17, college = 'Oregon' where id = '6cf4718f-43bd-46fa-9c7e-e2df433a74c9'; -- Akili Smith (QB), #17, Oregon; https://en.wikipedia.org/wiki/Akili_Smith
update rec_legend_catalog set jersey_number = 29, college = 'Grambling' where id = '52e2d903-9651-4338-b2a6-ea5f9d51a04b'; -- Albert Lewis (CB), #29, Grambling; https://en.wikipedia.org/wiki/Albert_Lewis_(American_football)
update rec_legend_catalog set college = 'Miami' where id = '0ccaf0f7-3277-42cb-af6b-3e7688a3b6fc'; -- Andre Johnson (WR), Miami; https://en.wikipedia.org/wiki/Andre_Johnson
update rec_legend_catalog set jersey_number = 84, college = 'Kutztown' where id = '0e0ae6f1-de8b-450e-8f5e-03634801037f'; -- Andre Reed (WR), #84, Kutztown; https://en.wikipedia.org/wiki/Andre_Reed
update rec_legend_catalog set jersey_number = 56, college = 'Iowa' where id = 'd92ae445-5497-4ddb-886b-581997e46db3'; -- Andre Tippett (LOLB), #56, Iowa; https://en.wikipedia.org/wiki/Andre_Tippett
update rec_legend_catalog set jersey_number = 1, college = 'Houston' where id = '68115a91-1095-4429-9b55-19f3db175f74'; -- Andre Ware (QB), #1, Houston; https://en.wikipedia.org/wiki/Andre_Ware
update rec_legend_catalog set jersey_number = 31, college = 'Florida State' where id = 'b61c8f36-c1b9-4c89-be24-68243fdbf6ed'; -- Antonio Cromartie (CB), #31, Florida State; https://en.wikipedia.org/wiki/Antonio_Cromartie
update rec_legend_catalog set college = 'Eastern Michigan' where id = 'a090d4dc-076f-49d2-98c4-09bb12ca4333'; -- Antonio Gates (TE), Eastern Michigan; https://en.wikipedia.org/wiki/Antonio_Gates
update rec_legend_catalog set jersey_number = 70, college = 'Boston College' where id = '7988967d-5b43-44b1-bbe4-142bf47aa7c2'; -- Art Donovan (DT), #70, Boston College; https://en.wikipedia.org/wiki/Art_Donovan
update rec_legend_catalog set jersey_number = 85, college = 'Syracuse' where id = '10a03011-4b17-495c-8a94-d92624c10fac'; -- Art Monk (WR), #85, Syracuse; https://en.wikipedia.org/wiki/Art_Monk
update rec_legend_catalog set jersey_number = 99, college = 'Auburn' where id = '7127a67a-d5b9-42eb-91f0-6cdab1c82820'; -- Aundray Bruce (LOLB), #99, Auburn; https://en.wikipedia.org/wiki/Aundray_Bruce
update rec_legend_catalog set jersey_number = 15, college = 'Alabama' where id = '578ca71d-a117-4c0e-bcb7-89a58f368881'; -- Bart Starr (QB), #15, Alabama; https://en.wikipedia.org/wiki/Bart_Starr
update rec_legend_catalog set jersey_number = 81, college = 'Livingstone' where id = 'bc70fd31-6543-4d4a-bf3a-e8359943f9de'; -- Ben Coates (TE), #81, Livingstone; https://en.wikipedia.org/wiki/Ben_Coates
update rec_legend_catalog set college = 'Miami' where id = '4038112d-76e5-4ce4-93f9-9607c625f197'; -- Ben Roethlisberger (QB), Miami; https://en.wikipedia.org/wiki/Ben_Roethlisberger
update rec_legend_catalog set jersey_number = 84, college = 'Georgia' where id = '6639466e-d651-4d86-8266-f76ef578504e'; -- Ben Watson (TE), #84, Georgia; https://en.wikipedia.org/wiki/Benjamin_Watson
update rec_legend_catalog set jersey_number = 18, college = 'Miami' where id = 'c2a75d22-9244-4704-888e-faba25451ce7'; -- Bernie Kosar (QB), #18, Miami; https://en.wikipedia.org/wiki/Bernie_Kosar
update rec_legend_catalog set jersey_number = 55, college = 'Georgia Tech' where id = 'e189a2dd-6620-4040-9fd7-d26a4b107b55'; -- Bill Curry (C), #55, Georgia Tech; https://en.wikipedia.org/wiki/Bill_Curry
update rec_legend_catalog set jersey_number = 71, college = 'Georgia' where id = '9f6185b6-8f69-4710-9ef5-397ce819adab'; -- Bill Goldberg (RG), #71, Georgia; https://en.wikipedia.org/wiki/Bill_Goldberg
update rec_legend_catalog set jersey_number = 53, college = 'Boston College' where id = '9db1ed7d-ea1f-4cd7-8609-c91bf49bff49'; -- Bill Romanowski (MLB), #53, Boston College; https://en.wikipedia.org/wiki/Bill_Romanowski
update rec_legend_catalog set college = 'Drake' where id = '7ac72a57-389a-41e9-bfee-84a1cd21e6a2'; -- Billy Cundiff (K), Drake; https://en.wikipedia.org/wiki/Billy_Cundiff
update rec_legend_catalog set jersey_number = 89, college = 'Michigan State' where id = '873baeb9-1f55-4295-bdfe-243bb920a20c'; -- Billy Joe Dupree (TE), #89, Michigan State; https://en.wikipedia.org/wiki/Billy_Joe_DuPree
update rec_legend_catalog set jersey_number = 88, college = 'Widener' where id = '9d597e5a-fadb-4385-a98d-3e71a60ea5c1'; -- Billy Johnson (WR), #88, Widener; https://en.wikipedia.org/wiki/Billy_"White_Shoes"_Johnson
update rec_legend_catalog set jersey_number = 31, college = 'Penn State' where id = 'dc2f6c9a-9b7c-446f-88ca-ebb4e02538d6'; -- Blair Thomas (HB), #31, Penn State; https://en.wikipedia.org/wiki/Blair_Thomas
update rec_legend_catalog set jersey_number = 78, college = 'Arkansas AM&N' where id = '3d737905-8bb3-4d94-af04-5100aad2362d'; -- Bob Brown (RT), #78, Arkansas AM&N; https://en.wikipedia.org/wiki/Bob_Brown_(defensive_lineman)
update rec_legend_catalog set jersey_number = 22, college = 'Florida A&M' where id = '037dc4a1-eb24-43d5-a8e0-527d48008686'; -- Bob Hayes (WR), #22, Florida A&M; https://en.wikipedia.org/wiki/Bob_Hayes
update rec_legend_catalog set college = 'TCU' where id = 'f05449f3-f961-4faa-9880-e468ae8fda37'; -- Bob Lilly (DT), TCU; https://en.wikipedia.org/wiki/Bob_Lilly
update rec_legend_catalog set jersey_number = 79, college = 'Tulsa' where id = '8b7ee76b-8c6d-43d7-ae93-630c31ce3935'; -- Bob St. Clair (RT), #79, Tulsa; https://en.wikipedia.org/wiki/Bob_St._Clair
update rec_legend_catalog set jersey_number = 22, college = 'Texas' where id = 'fde291c6-390f-469b-8fb6-651cad30fc1b'; -- Bobby Layne (QB), #22, Texas; https://en.wikipedia.org/wiki/Bobby_Layne
update rec_legend_catalog set jersey_number = 49, college = 'Illinois' where id = '48216b07-866d-481e-8faf-d1d786201816'; -- Bobby Mitchell (WR), #49, Illinois; https://en.wikipedia.org/wiki/Bobby_Mitchell
update rec_legend_catalog set jersey_number = 50, college = 'Michigan State' where id = '7c2649ed-742b-4463-9921-27ff3921fd6f'; -- Brad Van Pelt (LOLB), #50, Michigan State; https://en.wikipedia.org/wiki/Brad_Van_Pelt
update rec_legend_catalog set jersey_number = 9, college = 'Notre Dame' where id = '4f15a056-544e-4376-a7b8-8c9e30cd3f8a'; -- Brady Quinn (QB), #9, Notre Dame; https://en.wikipedia.org/wiki/Brady_Quinn
update rec_legend_catalog set college = 'Cincinnati' where id = '9f7deb02-91de-41ec-b049-273fdd5bd27c'; -- Brent Celek (TE), Cincinnati; https://en.wikipedia.org/wiki/Brent_Celek
update rec_legend_catalog set jersey_number = 24, college = 'Shippensburg' where id = '579557f0-415c-4b6f-866e-9da5143e1173'; -- Brent Grimes (CB), #24, Shippensburg; https://en.wikipedia.org/wiki/Brent_Grimes
update rec_legend_catalog set jersey_number = 84, college = 'Santa Clara' where id = 'b5f55607-4584-4220-9e15-edc391d0f046'; -- Brent Jones (TE), #84, Santa Clara; https://en.wikipedia.org/wiki/Brent_Jones
update rec_legend_catalog set college = 'Clemson' where id = 'd00327e3-6054-4bed-994a-a3a077b78ad5'; -- Brian Dawkins (SS), Clemson; https://en.wikipedia.org/wiki/Brian_Dawkins
update rec_legend_catalog set college = 'Virginia Tech' where id = 'fa82bc20-281a-4a02-91c8-4c7d9f2bbed2'; -- Bruce Smith (LE), Virginia Tech; https://en.wikipedia.org/wiki/Bruce_Smith
update rec_legend_catalog set jersey_number = 29, college = 'Northern Iowa' where id = '6f496335-f316-4561-b130-7d408803854b'; -- Bryce Paup (ROLB), #29, Northern Iowa; https://en.wikipedia.org/wiki/Bryce_Paup
update rec_legend_catalog set college = 'Geneva' where id = '6cb79458-3d9b-4afb-a396-255929cbf420'; -- Cal Hubbard (RT), Geneva; https://en.wikipedia.org/wiki/Cal_Hubbard
update rec_legend_catalog set college = 'Georgia Tech' where id = 'c31cd444-330a-4714-ab71-70d5d5e750c3'; -- Calvin Johnson (WR), Georgia Tech; https://en.wikipedia.org/wiki/Calvin_Johnson
update rec_legend_catalog set jersey_number = 58, college = 'Michigan State' where id = 'b19ccc23-e9d4-43ca-999e-71ed0b46fb99'; -- Carl Banks (LOLB), #58, Michigan State; https://en.wikipedia.org/wiki/Carl_Banks
update rec_legend_catalog set hand = 'Left' where id = '65f62207-f2a4-42f2-b10a-0750d5a29f61'; -- Carl Crawford (QB), hand; https://en.wikipedia.org/wiki/Carl_Crawford
update rec_legend_catalog set jersey_number = 71, college = 'Minnesota' where id = 'f499dff1-c806-44f8-84cc-01dda9f9d745'; -- Carl Eller (LE), #71, Minnesota; https://en.wikipedia.org/wiki/Carl_Eller
update rec_legend_catalog set jersey_number = 23, college = 'Oregon' where id = '16dd69a7-ae34-4545-9227-840736d9ade5'; -- Carl Lewis (WR), #23, Oregon; https://en.wikipedia.org/wiki/Woodley_Lewis
update rec_legend_catalog set jersey_number = 85, college = 'Oregon State' where id = '62733dea-bd6d-40e1-9168-e1f15651d781'; -- Chad Johnson (WR), #85, Oregon State; https://en.wikipedia.org/wiki/Chad_Johnson
update rec_legend_catalog set jersey_number = 80, college = 'Michigan State' where id = '2f4b0c11-bc1b-49d0-83e1-c4b32e86ae54'; -- Charles Rogers (WR), #80, Michigan State; https://en.wikipedia.org/wiki/Charles_Rogers_(wide_receiver)
update rec_legend_catalog set jersey_number = 42, college = 'Arizona State' where id = '1e79878a-5b18-4f39-a9b0-178017a4db60'; -- Charley Taylor (WR), #42, Arizona State; https://en.wikipedia.org/wiki/Charley_Taylor
update rec_legend_catalog set jersey_number = 2, college = 'Georgia' where id = '0450befa-ebdb-402e-9efb-3d9b2d31bfbb'; -- Charley Trippi (HB), #2, Georgia; https://en.wikipedia.org/wiki/Charley_Trippi
update rec_legend_catalog set jersey_number = 16, college = 'Eastern Michigan' where id = '1639b035-117b-4f8e-83fe-14f30cdde62c'; -- Charlie Batch (QB), #16, Eastern Michigan; https://en.wikipedia.org/wiki/Charlie_Batch
update rec_legend_catalog set jersey_number = 17, college = 'Florida State' where id = 'ca2f990c-3ad2-4b25-9b3a-07ff94258b25'; -- Charlie Ward (QB), #17, Florida State; https://en.wikipedia.org/wiki/Charlie_Ward
update rec_legend_catalog set jersey_number = 41, college = 'Clemson' where id = 'ee4e5fe5-e0f9-431d-bc32-c07a690b4bfc'; -- Charlie Waters (SS), #41, Clemson; https://en.wikipedia.org/wiki/Charlie_Waters
update rec_legend_catalog set jersey_number = 56, college = 'Pitt' where id = 'f9407294-0a3e-44c3-b380-cf0f233405eb'; -- Chris Doleman (RE), #56, Pitt; https://en.wikipedia.org/wiki/Chris_Doleman
update rec_legend_catalog set jersey_number = 56, college = 'Virginia' where id = '3e41ff34-28f9-4eb2-8267-db43db22a12b'; -- Chris Long (LE), #56, Virginia; https://en.wikipedia.org/wiki/Chris_Long
update rec_legend_catalog set jersey_number = 60, college = 'Penn' where id = '49f3ecaf-c065-4833-b24a-995738e3e711'; -- Chuck Bednarik (LOLB), #60, Penn; https://en.wikipedia.org/wiki/Chuck_Bednarik
update rec_legend_catalog set jersey_number = 87, college = 'Tennessee A&I' where id = '1e6dc633-6688-4a93-b559-775aacd84950'; -- Claude Humphrey (RE), #87, Tennessee A&I; https://en.wikipedia.org/wiki/Claude_Humphrey
update rec_legend_catalog set jersey_number = 52, college = 'USC' where id = '9eb98e3b-b223-4ac1-bed9-6be176822410'; -- Clay Matthews III (LOLB), #52, USC; https://en.wikipedia.org/wiki/Clay_Matthews_III
update rec_legend_catalog set jersey_number = 21, college = 'Colorado' where id = 'b322c900-9a2a-4325-93fe-2aac81fc7164'; -- Cliff Branch (WR), #21, Colorado; https://en.wikipedia.org/wiki/Cliff_Branch
update rec_legend_catalog set jersey_number = 43, college = 'Ouachita Baptist' where id = '9800cccb-e10f-48a9-806b-29ced27e8b9b'; -- Cliff Harris (FS), #43, Ouachita Baptist; https://en.wikipedia.org/wiki/Cliff_Harris
update rec_legend_catalog set jersey_number = 96, college = 'Western Carolina University' where id = '8357d061-3a71-4263-9c54-8233d5feae9e'; -- Clyde Simmons (RE), #96, Western Carolina University; https://en.wikipedia.org/wiki/Clyde_Simmons
update rec_legend_catalog set jersey_number = 5, college = 'Hawaii' where id = '4eddd3b7-0a24-4222-9564-4f4048d8e1ae'; -- Colt Brennan (QB), #5, Hawaii; https://en.wikipedia.org/wiki/Colt_Brennan
update rec_legend_catalog set jersey_number = 69, college = 'Wyoming' where id = '233eeb13-b75a-47ee-8cea-c1c7ca392b31'; -- Conrad Dobler (RG), #69, Wyoming; https://en.wikipedia.org/wiki/Conrad_Dobler
update rec_legend_catalog set jersey_number = 99, college = 'Miami' where id = 'ae488d08-2bd8-4db0-ab6e-6c9994040ff5'; -- Cortez Kennedy (DT), #99, Miami; https://en.wikipedia.org/wiki/Cortez_Kennedy
update rec_legend_catalog set jersey_number = 21, college = 'Samford' where id = '1bd33a0f-5c8b-492c-823b-e770ab8dcd13'; -- Cortland Finnegan (CB), #21, Samford; https://en.wikipedia.org/wiki/Cortland_Finnegan
update rec_legend_catalog set jersey_number = 98, college = 'Penn State' where id = '3eaf8513-c7bc-44c1-bc4f-e61508225f92'; -- Courtney Brown (RE), #98, Penn State; https://en.wikipedia.org/wiki/Courtney_Brown_(defensive_end)
update rec_legend_catalog set jersey_number = 33, college = 'Pitt' where id = '4d41acf2-f4fe-4989-a5a8-a0d6ba7add8b'; -- Craig Heyward (FB), #33, Pitt; https://en.wikipedia.org/wiki/Craig_Heyward
update rec_legend_catalog set college = 'Ohio State' where id = '79575b76-103e-4d6f-8fe3-5ee9ffc12340'; -- Cris Carter (WR), Ohio State; https://en.wikipedia.org/wiki/Cris_Carter
update rec_legend_catalog set jersey_number = 77, college = 'Arizona State' where id = '8af26d02-a36d-4519-bde6-2aac10fc70ff'; -- Curley Culp (DT), #77, Arizona State; https://en.wikipedia.org/wiki/Curley_Culp
update rec_legend_catalog set jersey_number = 26, college = 'Penn State' where id = 'e2e11373-7142-4631-afcc-f521b3b4570e'; -- Curtis Enis (HB), #26, Penn State; https://en.wikipedia.org/wiki/Curtis_Enis
update rec_legend_catalog set jersey_number = 28, college = 'Pitt' where id = '8696e81f-d7e4-4a98-9843-272fd4676f5a'; -- Curtis Martin (HB), #28, Pitt; https://en.wikipedia.org/wiki/Curtis_Martin
update rec_legend_catalog set jersey_number = 99, college = 'Arkansas' where id = 'b2c83343-de7a-4808-8631-c57b4946c781'; -- Dan Hampton (DT), #99, Arkansas; https://en.wikipedia.org/wiki/Dan_Hampton
update rec_legend_catalog set college = 'Pitt' where id = '159e61eb-854b-41f0-a58d-054a707e208a'; -- Dan Marino (QB), Pitt; https://en.wikipedia.org/wiki/Dan_Marino
update rec_legend_catalog set jersey_number = 11, college = 'San Diego State' where id = '8f057309-a6f0-4387-9c89-3dc6e0551bf4'; -- Dan McGwire (QB), #11, San Diego State; https://en.wikipedia.org/wiki/Dan_McGwire
update rec_legend_catalog set jersey_number = 97, college = 'Arizona State' where id = '55913e5b-347b-468b-a995-a787b77129b9'; -- Dan Saleaumua (DT), #97, Arizona State; https://en.wikipedia.org/wiki/Dan_Saleaumua
update rec_legend_catalog set jersey_number = 39, college = 'Chadron State' where id = '60b665c4-97a0-453d-9d9d-059a75b6c4f6'; -- Danny Woodhead (HB), #39, Chadron State; https://en.wikipedia.org/wiki/Danny_Woodhead
update rec_legend_catalog set jersey_number = 17, college = 'Florida' where id = 'c6bfbea1-e6f8-4db4-9a23-a36f837d582c'; -- Danny Wuerffel (QB), #17, Florida; https://en.wikipedia.org/wiki/Danny_Wuerffel
update rec_legend_catalog set jersey_number = 86, college = 'Ohio State' where id = 'dc9bc1f2-259b-4ed6-b946-21121e86e20c'; -- Dante Lavelli (WR), #86, Ohio State; https://en.wikipedia.org/wiki/Dante_Lavelli
update rec_legend_catalog set hand = 'Left' where id = '57bfc87c-1ed7-474c-a0ce-1048ce537124'; -- Darin Erstad (P), hand; https://en.wikipedia.org/wiki/Darin_Erstad
update rec_legend_catalog set jersey_number = 28, college = 'Texas A&I' where id = '0f951016-7436-4af9-a513-4c04a76fdf87'; -- Darrell Green (CB), #28, Texas A&I; https://en.wikipedia.org/wiki/Darrell_Green
update rec_legend_catalog set college = 'Pitt' where id = '7b31d1c8-1d8a-4af4-8d69-0b016f935cd9'; -- Darrelle Revis (CB), Pitt; https://en.wikipedia.org/wiki/Darrelle_Revis
update rec_legend_catalog set jersey_number = 28, college = 'Arizona State' where id = '97fed433-1171-429b-b859-d8b2218dc450'; -- Darren Woodson (SS), #28, Arizona State; https://en.wikipedia.org/wiki/Darren_Woodson
update rec_legend_catalog set college = 'Syracuse' where id = '10456e30-221a-4d14-97a9-28c72b9606f9'; -- Daryl Johnston (FB), Syracuse; https://en.wikipedia.org/wiki/Daryl_Johnston
update rec_legend_catalog set jersey_number = 65, college = 'Purdue' where id = 'b945e289-cad5-429d-986c-4a5c48535c9e'; -- Dave Butz (DT), #65, Purdue; https://en.wikipedia.org/wiki/Dave_Butz
update rec_legend_catalog set jersey_number = 44, college = 'Notre Dame' where id = 'e56d8d66-4260-47cd-96b7-39fa2b420588'; -- Dave Casper (TE), #44, Notre Dame; https://en.wikipedia.org/wiki/Dave_Casper
update rec_legend_catalog set jersey_number = 64, college = 'Oregon' where id = '4a5e16a0-4d45-4db8-af87-b2ee49d07383'; -- Dave Wilcox (LOLB), #64, Oregon; https://en.wikipedia.org/wiki/Dave_Wilcox
update rec_legend_catalog set jersey_number = 2, college = 'Louisville' where id = 'a14053f8-00f4-4cd7-8a70-e7ae0ecc577e'; -- David Akers (K), #2, Louisville; https://en.wikipedia.org/wiki/David_Akers
update rec_legend_catalog set jersey_number = 11, college = 'Houston' where id = '23bf20db-cc94-4d99-b302-65a6b6aeff69'; -- David Klingler (QB), #11, Houston; https://en.wikipedia.org/wiki/David_Klingler
update rec_legend_catalog set jersey_number = 13, college = 'Michigan' where id = '400bf164-f142-4cae-9b3e-314bb7f3b6a7'; -- David Terrell (WR), #13, Michigan; https://en.wikipedia.org/wiki/David_Terrell_(wide_receiver)
update rec_legend_catalog set college = 'Mississippi Valley State' where id = 'd407b78e-40c3-492c-8276-12642811a292'; -- Deacon Jones (LE), Mississippi Valley State; https://en.wikipedia.org/wiki/Deacon_Jones
update rec_legend_catalog set jersey_number = 11, college = 'Princeton' where id = 'fa3a6ea9-4fae-425d-93ea-4f3bf4786906'; -- Dean Cain (FS), #11, Princeton; https://en.wikipedia.org/wiki/Dean_Cain
update rec_legend_catalog set jersey_number = 27, college = 'Alabama' where id = '55f50cfa-0967-40b5-8cb8-21809fde7ff5'; -- Dee Milliner (CB), #27, Alabama; https://en.wikipedia.org/wiki/Dee_Milliner
update rec_legend_catalog set jersey_number = 82, college = 'Central Missouri' where id = 'ecadd835-c150-42fb-ae7d-cd170daf6574'; -- Delanie Walker (TE), #82, Central Missouri; https://en.wikipedia.org/wiki/Delanie_Walker
update rec_legend_catalog set jersey_number = 63, college = 'Kentucky' where id = '7599a94e-fc08-45d4-b985-aef2baee635a'; -- Dermontti Dawson (C), #63, Kentucky; https://en.wikipedia.org/wiki/Dermontti_Dawson
update rec_legend_catalog set jersey_number = 20, college = 'Rutgers' where id = '569fca10-77f9-4179-9a90-0e4b7a5ed200'; -- Deron Cherry (FS), #20, Rutgers; https://en.wikipedia.org/wiki/Deron_Cherry
update rec_legend_catalog set jersey_number = 95, college = 'Florida' where id = '3cb63f84-8774-475e-a2e1-43be49a58a45'; -- Derrick Harvey (RE), #95, Florida; https://en.wikipedia.org/wiki/Derrick_Harvey
update rec_legend_catalog set college = 'Miami' where id = '5eb91d67-e90e-4c94-8909-7fb398148dc4'; -- Devin Hester (WR), Miami; https://en.wikipedia.org/wiki/Devin_Hester
update rec_legend_catalog set jersey_number = 92, college = 'Oklahoma State' where id = 'bdc61a76-faea-43cb-ba5a-57521463087a'; -- Dexter Manley (LE), #92, Oklahoma State; https://en.wikipedia.org/wiki/Dexter_Manley
update rec_legend_catalog set jersey_number = 40, college = 'Colorado' where id = '928a3ec9-97de-4061-9ca5-f2cb965744d5'; -- Dick Anderson (SS), #40, Colorado; https://en.wikipedia.org/wiki/Dick_Anderson
update rec_legend_catalog set college = 'Oregon' where id = '80e33c9f-aaa3-4ec8-9921-c15f65f225fe'; -- Dion Jordan (LE), Oregon; https://en.wikipedia.org/wiki/Dion_Jordan
update rec_legend_catalog set jersey_number = 13, college = 'Texas Western' where id = 'd7995317-1e63-4c9b-9711-311f60b129bb'; -- Don Maynard (WR), #13, Texas Western; https://en.wikipedia.org/wiki/Don_Maynard
update rec_legend_catalog set jersey_number = 5, college = 'Syracuse' where id = 'c25b8f9e-1b12-4177-ac27-53a646d653ba'; -- Donovan McNabb (QB), #5, Syracuse; https://en.wikipedia.org/wiki/Donovan_McNabb
update rec_legend_catalog set jersey_number = 7, college = 'Boston College' where id = 'a57f575d-c069-442c-9846-6187979fd4f2'; -- Doug Flutie (QB), #7, Boston College; https://en.wikipedia.org/wiki/Doug_Flutie
update rec_legend_catalog set college = 'Grambling' where id = 'a99826d2-c833-4ab1-b724-7ebca65d6fca'; -- Doug Williams (QB), Grambling; https://en.wikipedia.org/wiki/Doug_Williams_(quarterback)
update rec_legend_catalog set jersey_number = 88, college = 'Tulsa' where id = 'fb8eb88e-8f97-4665-a05f-81992e41c549'; -- Drew Pearson (WR), #88, Tulsa; https://en.wikipedia.org/wiki/Drew_Pearson_(American_football)
update rec_legend_catalog set jersey_number = 47, college = 'West Texas State' where id = '2a7c6cd7-c20a-40cb-b44b-64c4034c5b1d'; -- Duane Thomas (HB), #47, West Texas State; https://en.wikipedia.org/wiki/Duane_Thomas
update rec_legend_catalog set jersey_number = 87, college = 'Clemson' where id = 'f1bf8f7e-66ee-4426-8e02-6ef92ff501cb'; -- Dwight Clark (WR), #87, Clemson; https://en.wikipedia.org/wiki/Dwight_Clark
update rec_legend_catalog set jersey_number = 57, college = 'Alabama' where id = '3272763a-f2fa-4293-a264-ba620e63cf2e'; -- Dwight Stephenson (C), #57, Alabama; https://en.wikipedia.org/wiki/Dwight_Stephenson
update rec_legend_catalog set jersey_number = 29, college = 'Texas' where id = '8a859c8f-3bc8-4eeb-ba0a-76bc300b6f02'; -- Earl Thomas (FS), #29, Texas; https://en.wikipedia.org/wiki/Earl_Thomas
update rec_legend_catalog set college = 'Tennessee State' where id = '7caeb686-69d2-45e6-aa85-9829472389f2'; -- Ed "Too Tall" Jones (LE), Tennessee State; https://en.wikipedia.org/wiki/Ed_"Too_Tall"_Jones
update rec_legend_catalog set jersey_number = 17, college = 'Houston' where id = '6a48da6d-238b-453a-9a29-7787632841fc'; -- Elmo Wright (WR), #17, Houston; https://en.wikipedia.org/wiki/Elmo_Wright
update rec_legend_catalog set jersey_number = 65, college = 'North Carolina A&T' where id = '05d2ccef-92a8-451a-aa73-fef414cf21d4'; -- Elvin Bethea (RE), #65, North Carolina A&T; https://en.wikipedia.org/wiki/Elvin_Bethea
update rec_legend_catalog set jersey_number = 45, college = 'Iowa' where id = '869f366f-bea9-4173-ae7f-eb9817194e47'; -- Emlen Tunnell (FS), #45, Iowa; https://en.wikipedia.org/wiki/Emlen_Tunnell
update rec_legend_catalog set college = 'Florida' where id = '4d774831-e36c-4694-8d98-3bac1555c477'; -- Emmitt Smith (HB), Florida; https://en.wikipedia.org/wiki/Emmitt_Smith
update rec_legend_catalog set jersey_number = 18, college = 'Bishop' where id = 'e0aca3c4-a88c-4f9f-bc33-d079260cbdd0'; -- Emmitt Thomas (CB), #18, Bishop; https://en.wikipedia.org/wiki/Emmitt_Thomas
update rec_legend_catalog set jersey_number = 9, college = 'Nebraska' where id = 'cd4a2055-71f6-49c1-9adc-1e9e9f2f56e5'; -- Eric Crouch (QB), #9, Nebraska; https://en.wikipedia.org/wiki/Eric_Crouch
update rec_legend_catalog set college = 'SMU' where id = 'b9acbc1b-0d1d-4ac1-8240-3e263e5f41c4'; -- Eric Dickerson (HB), SMU; https://en.wikipedia.org/wiki/Eric_Dickerson
update rec_legend_catalog set jersey_number = 86, college = 'Liberty' where id = 'a40cb846-e439-4d01-974e-92b2b66efb9f'; -- Eric Green (TE), #86, Liberty; https://en.wikipedia.org/wiki/Eric_Green_(tight_end)
update rec_legend_catalog set jersey_number = 42, college = 'UCLA' where id = 'fa2e754d-1c03-429d-84ce-5a2b1db08fa7'; -- Eric Turner (FS), #42, UCLA; https://en.wikipedia.org/wiki/Eric_Turner_(American_football)
update rec_legend_catalog set jersey_number = 20, college = 'Utah' where id = 'fa71243d-a3ee-412e-8cb4-65ae8ace1d95'; -- Eric Weddle (FS), #20, Utah; https://en.wikipedia.org/wiki/Eric_Weddle
update rec_legend_catalog set jersey_number = 84, college = 'Louisville' where id = '32a18df8-2920-4402-a840-04730bc771cd'; -- Ernest Givins (WR), #84, Louisville; https://en.wikipedia.org/wiki/Ernest_Givins
update rec_legend_catalog set jersey_number = 41, college = 'Colgate' where id = '295bed6c-6178-41ba-869c-18a68cd97956'; -- Eugene Robinson (FS), #41, Colgate; https://en.wikipedia.org/wiki/Eugene_Robinson_(American_football)
update rec_legend_catalog set jersey_number = 28, college = 'Grambling' where id = '46218bc6-f7fa-45fe-8abe-839ed93c3984'; -- Everson Walls (CB), #28, Grambling; https://en.wikipedia.org/wiki/Everson_Walls
update rec_legend_catalog set jersey_number = 44, college = 'Syracuse' where id = '179b7564-643d-4f18-bdf9-e353010b43de'; -- Floyd Little (HB), #44, Syracuse; https://en.wikipedia.org/wiki/Floyd_Little
update rec_legend_catalog set college = 'SMU' where id = '62f371c0-32c3-47ca-9b74-9a081924599a'; -- Forrest Gregg (LT), SMU; https://en.wikipedia.org/wiki/Forrest_Gregg
update rec_legend_catalog set jersey_number = 10, college = 'Georgia' where id = '3aa37ddf-7ef6-4a48-8681-168ada2c6259'; -- Fran Tarkenton (QB), #10, Georgia; https://en.wikipedia.org/wiki/Fran_Tarkenton
update rec_legend_catalog set college = 'Miami' where id = 'b2e2dd69-79c3-4ca1-87ec-3b6f37dbcf5b'; -- Frank Gore (HB), Miami; https://en.wikipedia.org/wiki/Frank_Gore
update rec_legend_catalog set jersey_number = 22, college = 'Coe' where id = '2080f113-12da-419b-a7e6-bc7c56db2aee'; -- Fred Jackson (HB), #22, Coe; https://en.wikipedia.org/wiki/Fred_Jackson_(running_back)
update rec_legend_catalog set jersey_number = 24, college = 'Northwestern' where id = 'f99c22ad-5673-4e5d-acac-aff024df5f12'; -- Fred Williamson (CB), #24, Northwestern; https://en.wikipedia.org/wiki/Fred_Williamson
update rec_legend_catalog set college = 'Minnesota' where id = 'a9940806-a6bf-46a9-8062-cbdc54759c11'; -- Gable Steveson (DT), Minnesota; https://en.wikipedia.org/wiki/Gable_Steveson
update rec_legend_catalog set jersey_number = 40, college = 'Kansas' where id = '00d171a5-50f8-4bf3-9878-70321da9b13e'; -- Gale Sayers (HB), #40, Kansas; https://en.wikipedia.org/wiki/Gale_Sayers
update rec_legend_catalog set jersey_number = 1 where id = 'eac2bd8e-f403-4a8d-b2f9-2afc4fcc11cd'; -- Garo Yepremian (K), #1; https://en.wikipedia.org/wiki/Garo_Yepremian
update rec_legend_catalog set hand = 'Left' where id = '8c2d8824-bd04-45e7-b5fe-654929f35540'; -- Gary Anderson (K), hand; https://en.wikipedia.org/wiki/Gary_Anderson_(placekicker)
update rec_legend_catalog set jersey_number = 65, college = 'Oregon' where id = '39f9a30c-d2bf-4e6d-b089-ec761e01a639'; -- Gary Zimmerman (LT), #65, Oregon; https://en.wikipedia.org/wiki/Gary_Zimmerman
update rec_legend_catalog set jersey_number = 63, college = 'Texas A&I' where id = '8d411e36-edd3-42f8-a9b2-62c2704b5fd6'; -- Gene Upshaw (LG), #63, Texas A&I; https://en.wikipedia.org/wiki/Gene_Upshaw
update rec_legend_catalog set jersey_number = 16, college = 'Kentucky' where id = '0c6e84cf-bf7f-4740-8ca6-6247d7ed4b4b'; -- George Blanda (QB), #16, Kentucky; https://en.wikipedia.org/wiki/George_Blanda
update rec_legend_catalog set jersey_number = 89, college = 'San Francisco' where id = 'cd15bcc5-5fd7-46c2-99d3-b8120869c832'; -- Gino Marchetti (LE), #89, San Francisco; https://en.wikipedia.org/wiki/Gino_Marchetti
update rec_legend_catalog set jersey_number = 13, college = 'Miami' where id = 'd193dc44-abeb-4d5f-ad26-7ed752db11a3'; -- Gino Torretta (QB), #13, Miami; https://en.wikipedia.org/wiki/Gino_Torretta
update rec_legend_catalog set jersey_number = 71, college = 'Utah State' where id = 'fb2ad7d8-1696-485a-aa21-980ab15729d0'; -- Greg Kragen (DT), #71, Utah State; https://en.wikipedia.org/wiki/Greg_Kragen
update rec_legend_catalog set jersey_number = 95, college = 'Fort Valley State' where id = '777eba57-7cd2-4b34-9748-eb8a6ab9938b'; -- Greg Lloyd (LOLB), #95, Fort Valley State; https://en.wikipedia.org/wiki/Greg_Lloyd
update rec_legend_catalog set college = 'Miami' where id = '01c076c7-66aa-4cce-9c0c-8247c1c274c4'; -- Greg Olsen (TE), Miami; https://en.wikipedia.org/wiki/Greg_Olsen_(American_football)
update rec_legend_catalog set jersey_number = 78, college = 'Auburn' where id = 'bea5f962-ea13-49a5-bcee-88a4003d8dcf'; -- Greg Robinson (LT), #78, Auburn; https://en.wikipedia.org/wiki/Greg_Robinson_(offensive_tackle)
update rec_legend_catalog set jersey_number = 53, college = 'South Carolina State' where id = '291fd1dd-c6d8-4fd1-9ad4-32d52ef0159f'; -- Harry Carson (MLB), #53, South Carolina State; https://en.wikipedia.org/wiki/Harry_Carson
update rec_legend_catalog set jersey_number = 79, college = 'East Texas State' where id = 'b0a65077-70f2-4c0e-919c-d5a6da9ad072'; -- Harvey Martin (RE), #79, East Texas State; https://en.wikipedia.org/wiki/Harvey_Martin
update rec_legend_catalog set jersey_number = 83, college = 'Virginia' where id = '01707061-f16f-4520-ac1c-a2fd56c02853'; -- Heath Miller (TE), #83, Virginia; https://en.wikipedia.org/wiki/Heath_Miller
update rec_legend_catalog set jersey_number = 5, college = 'Tennessee' where id = '8633e65c-c61d-4785-835f-106fed608ae9'; -- Heath Shuler (QB), #5, Tennessee; https://en.wikipedia.org/wiki/Heath_Shuler
update rec_legend_catalog set college = 'Georgia' where id = 'a75213fa-1122-4c78-a277-fcd326513e65'; -- Hines Ward (WR), Georgia; https://en.wikipedia.org/wiki/Hines_Ward
update rec_legend_catalog set jersey_number = 39, college = 'Washington' where id = '6b772764-315d-4af1-8b49-fdfd3bc85e83'; -- Hugh McElhenny (HB), #39, Washington; https://en.wikipedia.org/wiki/Hugh_McElhenny
update rec_legend_catalog set jersey_number = 79, college = 'Georgia' where id = '977811dc-e332-4bed-9985-f57b4e3afc57'; -- Isaiah Wilson (RT), #79, Georgia; https://en.wikipedia.org/wiki/Isaiah_Wilson
update rec_legend_catalog set jersey_number = 99, college = 'Wisconsin' where id = 'b6f0b042-d7f7-44af-8f7a-45375a930742'; -- J.J. Watt (RE), #99, Wisconsin; https://en.wikipedia.org/wiki/J._J._Watt
update rec_legend_catalog set college = 'Penn State' where id = '90f7946e-1f02-4903-82b9-799e01d84c13'; -- Jack Ham (LOLB), Penn State; https://en.wikipedia.org/wiki/Jack_Ham
update rec_legend_catalog set college = 'Kent State' where id = 'dfdc8733-ee17-4e47-8143-32263bab7420'; -- Jack Lambert (MLB), Kent State; https://en.wikipedia.org/wiki/Jack_Lambert_(American_football)
update rec_legend_catalog set jersey_number = 28, college = 'Ohio State' where id = '53079e8e-0b36-45e0-81ff-cb2238a72acd'; -- Jack Tatum (FS), #28, Ohio State; https://en.wikipedia.org/wiki/Jack_Tatum
update rec_legend_catalog set jersey_number = 85, college = 'Florida' where id = '569315dd-6a64-4510-a898-9b9a1d80acde'; -- Jack Youngblood (RE), #85, Florida; https://en.wikipedia.org/wiki/Jack_Youngblood
update rec_legend_catalog set jersey_number = 81, college = 'Northwestern State' where id = '4bbd1ed9-6c5a-44a8-8cc5-6226bb8d3697'; -- Jackie Smith (TE), #81, Northwestern State; https://en.wikipedia.org/wiki/Jackie_Smith
update rec_legend_catalog set jersey_number = 16, college = 'Arizona State' where id = 'e267337d-04d9-4585-87d3-fbad9ef83692'; -- Jake Plummer (QB), #16, Arizona State; https://en.wikipedia.org/wiki/Jake_Plummer
update rec_legend_catalog set jersey_number = 92, college = 'Arkansas' where id = 'cee7b1db-d6d9-4b87-876a-ffecddf9e064'; -- Jamaal Anderson (RE), #92, Arkansas; https://en.wikipedia.org/wiki/Jamaal_Anderson
update rec_legend_catalog set jersey_number = 31, college = 'Texas' where id = 'ed6031fd-dab6-485d-be13-6bf78701462a'; -- Jamaal Charles (HB), #31, Texas; https://en.wikipedia.org/wiki/Jamaal_Charles
update rec_legend_catalog set jersey_number = 2, college = 'LSU' where id = '96124440-ec9c-4b04-99a8-ad1d44d50c84'; -- JaMarcus Russell (QB), #2, LSU; https://en.wikipedia.org/wiki/JaMarcus_Russell
update rec_legend_catalog set jersey_number = 92, college = 'Kent State' where id = 'a843b5f2-75db-436d-9ed7-be7723e76617'; -- James Harrison (LOLB), #92, Kent State; https://en.wikipedia.org/wiki/James_Harrison_(American_football)
update rec_legend_catalog set jersey_number = 22, college = 'Stanford' where id = '1d7757a2-d210-4470-8acf-a00ef41de053'; -- James Lofton (WR), #22, Stanford; https://en.wikipedia.org/wiki/James_Lofton
update rec_legend_catalog set jersey_number = 10, college = 'Montana State' where id = 'bb0305ba-0ca9-4df9-acc4-428bdddf702f'; -- Jan Stenerud (K), #10, Montana State; https://en.wikipedia.org/wiki/Jan_Stenerud
update rec_legend_catalog set jersey_number = 69, college = 'Idaho State' where id = 'd5e038ff-5274-49a3-84bc-3e51a69e484b'; -- Jared Allen (RE), #69, Idaho State; https://en.wikipedia.org/wiki/Jared_Allen
update rec_legend_catalog set jersey_number = 1, college = 'Hawaii' where id = 'afca2327-aa2d-4ff0-9853-81c956903a3f'; -- Jason Elam (K), #1, Hawaii; https://en.wikipedia.org/wiki/Jason_Elam
update rec_legend_catalog set college = 'Baylor' where id = 'd5863d6b-b33e-423d-9da6-c126eb6c8d1b'; -- Jason Smith (LT), Baylor; https://en.wikipedia.org/wiki/Jason_Smith_(American_football)
update rec_legend_catalog set jersey_number = 18 where id = 'f4a1575c-d295-4329-a083-e91e72808c67'; -- Jason White (QB), #18; https://en.wikipedia.org/wiki/Jason_White_(American_football)
update rec_legend_catalog set college = 'Tennessee' where id = 'd823909c-766f-4f64-b708-548031689042'; -- Jason Witten (TE), Tennessee; https://en.wikipedia.org/wiki/Jason_Witten
update rec_legend_catalog set jersey_number = 84, college = 'Wyoming' where id = 'fe0d8963-de23-4375-9e35-3830b145e120'; -- Jay Novacek (TE), #84, Wyoming; https://en.wikipedia.org/wiki/Jay_Novacek
update rec_legend_catalog set jersey_number = 3, college = 'Illinois' where id = '873ec34c-9e96-4cd1-95e7-d6171430959e'; -- Jeff George (QB), #3, Illinois; https://en.wikipedia.org/wiki/Jeff_George
update rec_legend_catalog set jersey_number = 63, college = 'North Carolina' where id = '467f584d-8493-45b0-a462-1beaba85b8d7'; -- Jeff Saturday (C), #63, North Carolina; https://en.wikipedia.org/wiki/Jeff_Saturday
update rec_legend_catalog set jersey_number = 99, college = 'Miami' where id = '54c19db9-8521-4237-8dad-788ff9531cc2'; -- Jerome Brown (DT), #99, Miami; https://en.wikipedia.org/wiki/Jerome_Brown
update rec_legend_catalog set jersey_number = 4, college = 'Southern Miss' where id = '866cbe15-0c4c-4dc4-bb27-a75586687493'; -- Jerrel Wilson (P), #4, Southern Miss; https://en.wikipedia.org/wiki/Jerrel_Wilson
update rec_legend_catalog set jersey_number = 61, college = 'Hawaii' where id = '4807678d-5190-4ac5-9041-3981296fd377'; -- Jesse Sapolu (C), #61, Hawaii; https://en.wikipedia.org/wiki/Jesse_Sapolu
update rec_legend_catalog set jersey_number = 58, college = 'Valdosta State' where id = 'a279475a-fbeb-4dc4-bf1c-0c10ab41ece7'; -- Jessie Tuggle (MLB), #58, Valdosta State; https://en.wikipedia.org/wiki/Jessie_Tuggle
update rec_legend_catalog set jersey_number = 25, college = 'Wisconsin' where id = 'f6ebd768-89e6-46bb-b103-8466bde534d4'; -- Jim Bakken (K), #25, Wisconsin; https://en.wikipedia.org/wiki/Jim_Bakken
update rec_legend_catalog set jersey_number = 17, college = 'Purdue' where id = '653759e5-99bc-4a32-8f81-30e453f67c45'; -- Jim Everett (QB), #17, Purdue; https://en.wikipedia.org/wiki/Jim_Everett
update rec_legend_catalog set jersey_number = 79, college = 'Ohio State' where id = 'e10fe0dd-5e92-488f-ad5b-bb1b5f9fb909'; -- Jim Lachey (LT), #79, Ohio State; https://en.wikipedia.org/wiki/Jim_Lachey
update rec_legend_catalog set jersey_number = 58, college = 'South Dakota State' where id = '356a2c70-f9e5-4bb7-b02a-71c3a96c8f6b'; -- Jim Langer (C), #58, South Dakota State; https://en.wikipedia.org/wiki/Jim_Langer
update rec_legend_catalog set jersey_number = 70, college = 'Ohio State' where id = '2ba84a9f-6edf-4328-aaa5-a652cab43be1'; -- Jim Marshall (RE), #70, Ohio State; https://en.wikipedia.org/wiki/Jim_Marshall_(defensive_end)
update rec_legend_catalog set jersey_number = 9, college = 'BYU' where id = 'e5a9f527-b514-4df0-935b-8df13375a098'; -- Jim McMahon (QB), #9, BYU; https://en.wikipedia.org/wiki/Jim_McMahon
update rec_legend_catalog set college = 'Miami' where id = '9c3a1799-691d-4d47-aa48-fa9b1ed6bfd5'; -- Jim Otto (C), Miami; https://en.wikipedia.org/wiki/Jim_Otto
update rec_legend_catalog set college = 'Ohio State' where id = 'd3e2c045-88a0-4d8c-8d06-f06edc038067'; -- Jim Parker (LT), Ohio State; https://en.wikipedia.org/wiki/Jim_Parker_(American_football)
update rec_legend_catalog set college = '1956–1957)' where id = 'c9e138da-d052-4863-9a35-d6380b394dab'; -- Jim Taylor (FB), 1956–1957); https://en.wikipedia.org/wiki/Jim_Taylor_(fullback)
update rec_legend_catalog set college = 'Miami' where id = 'f8e1c641-2f5a-46f4-b6c4-974e03592d2a'; -- Jimmy Graham (TE), Miami; https://en.wikipedia.org/wiki/Jimmy_Graham
update rec_legend_catalog set jersey_number = 37, college = 'UCLA' where id = 'c09034f5-8d34-4f3f-a557-424f617e5af8'; -- Jimmy Johnson (CB), #37, UCLA; https://en.wikipedia.org/wiki/Jimmy_Johnson_(cornerback)
update rec_legend_catalog set jersey_number = 64, college = 'Michigan State' where id = '0b822dac-2bc3-4322-8c34-35066c5f8855'; -- Joe DeLamielleure (RG), #64, Michigan State; https://en.wikipedia.org/wiki/Joe_DeLamielleure
update rec_legend_catalog set jersey_number = 66, college = 'Louisville' where id = '2f4a3e03-270e-4132-995a-7d2d3d9a74e8'; -- Joe Jacoby (LT), #66, Louisville; https://en.wikipedia.org/wiki/Joe_Jacoby
update rec_legend_catalog set college = 'Notre Dame' where id = 'b7aef6ae-7bbf-4fb7-b6ed-436e59ff353d'; -- Joe Montana (QB), Notre Dame; https://en.wikipedia.org/wiki/Joe_Montana
update rec_legend_catalog set jersey_number = 56, college = 'Pitt' where id = 'f0de9bf9-9515-4f2b-8ba1-6f86bfd3e2f9'; -- Joe Schmidt (MLB), #56, Pitt; https://en.wikipedia.org/wiki/Joe_Schmidt_(American_football)
update rec_legend_catalog set jersey_number = 47, college = 'USC' where id = '37cafb78-d2b4-4ff3-883e-ab06839c12c2'; -- Joey Browner (SS), #47, USC; https://en.wikipedia.org/wiki/Joey_Browner
update rec_legend_catalog set jersey_number = 59, college = 'Michigan' where id = '4456d96d-5dfd-44ae-913c-ef6176481ce9'; -- John Anderson (ROLB), #59, Michigan; https://en.wikipedia.org/wiki/John_Anderson_(American_football)
update rec_legend_catalog set jersey_number = 14, college = 'Alabama' where id = 'b32fe257-9ec7-4739-a4a9-7f11a3b29bcd'; -- John Brodie (QB), #14, Alabama; https://en.wikipedia.org/wiki/Brodie_Croyle
update rec_legend_catalog set college = 'Stanford' where id = 'a62852f7-8a4b-4ba0-a684-4443bc6d345e'; -- John Elway (QB), Stanford; https://en.wikipedia.org/wiki/John_Elway
update rec_legend_catalog set jersey_number = 35, college = 'Arizona State' where id = '77b183b1-e68d-45db-a5a5-4937ef7aedc1'; -- John Henry Johnson (HB), #35, Arizona State; https://en.wikipedia.org/wiki/John_Henry_Johnson
update rec_legend_catalog set college = 'Cal Poly' where id = 'b9cd6def-e7c8-4f86-8fb0-b64456b96eb4'; -- John Madden (LT), Cal Poly; https://en.wikipedia.org/wiki/John_Madden
update rec_legend_catalog set jersey_number = 56, college = 'Western Michigan' where id = '64673c65-9730-45bc-8571-e38b8e616765'; -- John Offerdahl (MLB), #56, Western Michigan; https://en.wikipedia.org/wiki/John_Offerdahl
update rec_legend_catalog set college = 'Washington' where id = '0ba23a09-ace3-40c7-9dfa-0085507f156c'; -- John Ross (WR), Washington; https://en.wikipedia.org/wiki/John_Ross_(American_football)
update rec_legend_catalog set jersey_number = 82, college = 'Alabama A&M' where id = 'fa678ddc-1c81-4207-9f0f-68c812611b4c'; -- John Stallworth (WR), #82, Alabama A&M; https://en.wikipedia.org/wiki/John_Stallworth
update rec_legend_catalog set jersey_number = 2, college = 'Texas A&M' where id = '15347fc7-f85d-447f-9fdd-acb860927f21'; -- Johnny Manziel (QB), #2, Texas A&M; https://en.wikipedia.org/wiki/Johnny_Manziel
update rec_legend_catalog set jersey_number = 16, college = 'Kent State' where id = 'a7b7aafb-2442-462f-842a-221b2f60882a'; -- Josh Cribbs (WR), #16, Kent State; https://en.wikipedia.org/wiki/Josh_Cribbs
update rec_legend_catalog set college = 'Sam Houston State' where id = 'd551349e-26a7-4eb6-b2a8-68261a780443'; -- Josh McCown (QB), Sam Houston State; https://en.wikipedia.org/wiki/Josh_McCown
update rec_legend_catalog set jersey_number = 16, college = 'UCLA' where id = 'fb870088-b77a-4ce5-a76e-71401e556ab0'; -- Josh Rosen (QB), #16, UCLA; https://en.wikipedia.org/wiki/Josh_Rosen
update rec_legend_catalog set jersey_number = 0, college = 'Oklahoma State' where id = 'e2225b79-499d-4b45-aa1d-ff30e2ccb1fe'; -- Justin Gilbert (CB), #0, Oklahoma State; https://en.wikipedia.org/wiki/Justin_Gilbert
update rec_legend_catalog set college = 'Texas' where id = '4269e755-4697-4e3b-aae4-d44dac9203f4'; -- Justin Tucker (K), Texas; https://en.wikipedia.org/wiki/Justin_Tucker
update rec_legend_catalog set jersey_number = 77, college = 'Minnesota' where id = '86174b41-ba3b-4d6c-8255-65a7d4913047'; -- Karl Mecklenburg (MLB), #77, Minnesota; https://en.wikipedia.org/wiki/Karl_Mecklenburg
update rec_legend_catalog set jersey_number = 77, college = 'Washington State' where id = '6f0e9345-3215-4a62-ad76-752194ecfc90'; -- Keith Millard (DT), #77, Washington State; https://en.wikipedia.org/wiki/Keith_Millard
update rec_legend_catalog set jersey_number = 14, college = 'Augustana' where id = '20704d6c-461c-4833-ba22-f1a5d69070a0'; -- Ken Anderson (QB), #14, Augustana; https://en.wikipedia.org/wiki/Ken_Anderson_(quarterback)
update rec_legend_catalog set jersey_number = 27, college = 'Prairie View A&M' where id = '37ea3c9e-d343-4f8d-9142-1b151c3ef5cb'; -- Ken Houston (SS), #27, Prairie View A&M; https://en.wikipedia.org/wiki/Ken_Houston
update rec_legend_catalog set college = 'UCLA' where id = '0d69d25e-9634-444e-b971-97efaffbece7'; -- Ken Norton Jr. (MLB), UCLA; https://en.wikipedia.org/wiki/Ken_Norton_Jr.
update rec_legend_catalog set hand = 'Left', jersey_number = 16, college = 'Alabama' where id = '55787e0b-4c10-4662-98dd-717084f2706b'; -- Ken Stabler (QB), hand, #16, Alabama; https://en.wikipedia.org/wiki/Ken_Stabler
update rec_legend_catalog set jersey_number = 91, college = 'Auburn' where id = 'f7db037c-00e2-449a-9f81-044e9152b95b'; -- Kevin Greene (LOLB), #91, Auburn; https://en.wikipedia.org/wiki/Kevin_Greene
update rec_legend_catalog set jersey_number = 17, college = 'West Virginia' where id = '471807f8-9446-4138-b962-c5851f1a9994'; -- Kevin White (WR), #17, West Virginia; https://en.wikipedia.org/wiki/Kevin_White_(American_football)
update rec_legend_catalog set jersey_number = 94, college = 'Oklahoma State' where id = '79e4af49-277d-4526-8aa5-86d3a6a41fc8'; -- Kevin Williams (DT), #94, Oklahoma State; https://en.wikipedia.org/wiki/Kevin_Williams_(defensive_tackle)
update rec_legend_catalog set jersey_number = 23, college = 'Penn State' where id = 'b805d2f8-36e2-42c5-87e0-1e721ba04e04'; -- Ki-Jana Carter (HB), #23, Penn State; https://en.wikipedia.org/wiki/Ki-Jana_Carter
update rec_legend_catalog set jersey_number = 10, college = 'Colorado' where id = 'c4d3e840-560b-4bc4-aa7d-b80ee703b229'; -- Kordell Stewart (QB), #10, Colorado; https://en.wikipedia.org/wiki/Kordell_Stewart
update rec_legend_catalog set jersey_number = 77, college = 'Ohio State' where id = 'a79fb55e-8a36-4676-b15a-82d98a124879'; -- Korey Stringer (RT), #77, Ohio State; https://en.wikipedia.org/wiki/Korey_Stringer
update rec_legend_catalog set jersey_number = 13, college = 'Northern Iowa' where id = '2f5c7255-6657-4508-93ea-2ec14117d948'; -- Kurt Warner (QB), #13, Northern Iowa; https://en.wikipedia.org/wiki/Kurt_Warner
update rec_legend_catalog set jersey_number = 80, college = 'Penn State' where id = 'da845592-dd3b-4168-9d24-9c789b8f4411'; -- Kyle Brady (TE), #80, Penn State; https://en.wikipedia.org/wiki/Kyle_Brady
update rec_legend_catalog set jersey_number = 93, college = 'Nebraska' where id = 'a0c3174b-3eda-4333-b799-a4a7cb1e34fd'; -- Kyle Vanden Bosch (RE), #93, Nebraska; https://en.wikipedia.org/wiki/Kyle_Vanden_Bosch
update rec_legend_catalog set jersey_number = 68, college = 'Arkansas-Pine Bluff' where id = 'a7e7b8b2-76d0-4d88-87f1-ca314daba7f6'; -- L.C. Greenwood (LE), #68, Arkansas-Pine Bluff; https://en.wikipedia.org/wiki/L._C._Greenwood
update rec_legend_catalog set college = 'TCU' where id = '3fcb7231-d13e-4b71-abb8-3c7880b8d7ee'; -- LaDainian Tomlinson (HB), TCU; https://en.wikipedia.org/wiki/LaDainian_Tomlinson
update rec_legend_catalog set college = 'Sonoma State' where id = '34567036-021b-4461-a055-61b026e3ae19'; -- Larry Allen (LG), Sonoma State; https://en.wikipedia.org/wiki/Larry_Allen
update rec_legend_catalog set jersey_number = 66, college = 'Bethune–Cookman' where id = 'd102fac4-44bd-4ada-8471-536c3b78183c'; -- Larry Little (RG), #66, Bethune–Cookman; https://en.wikipedia.org/wiki/Larry_Little
update rec_legend_catalog set jersey_number = 8, college = 'Utah' where id = 'f179ade5-ee05-4ddb-b670-0b73319cdeaf'; -- Larry Wilson (SS), #8, Utah; https://en.wikipedia.org/wiki/Larry_Wilson_(American_football)
update rec_legend_catalog set college = 'Nebraska' where id = '61de7cf2-3975-4f28-aafb-cb2c798dc707'; -- Lawrence Phillips (HB), Nebraska; https://en.wikipedia.org/wiki/Lawrence_Phillips
update rec_legend_catalog set jersey_number = 20, college = 'Jackson State' where id = '72654fb1-1675-4c98-835d-0ed92d365037'; -- Lem Barney (CB), #20, Jackson State; https://en.wikipedia.org/wiki/Lem_Barney
update rec_legend_catalog set jersey_number = 18, college = 'Purdue' where id = '1f2b3f92-7ae8-4c0b-a93c-0ceb91901b1b'; -- Len Dawson (QB), #18, Purdue; https://en.wikipedia.org/wiki/Len_Dawson
update rec_legend_catalog set jersey_number = 24, college = 'Penn State' where id = '81b7d5d0-ed4b-4837-8dea-cc299673312e'; -- Lenny Moore (HB), #24, Penn State; https://en.wikipedia.org/wiki/Lenny_Moore
update rec_legend_catalog set jersey_number = 94, college = 'Emporia State' where id = '461631cf-f762-419c-b9a4-516cd8356da1'; -- Leon Lett (DT), #94, Emporia State; https://en.wikipedia.org/wiki/Leon_Lett
update rec_legend_catalog set college = 'Florida State' where id = 'd3304506-5bef-46ba-801f-9222602d4786'; -- Leon Washington (HB), Florida State; https://en.wikipedia.org/wiki/Leon_Washington
update rec_legend_catalog set jersey_number = 70, college = 'LSU' where id = '200a3c94-6546-48e9-9944-e9962ca9b957'; -- Leonard Marshall (LE), #70, LSU; https://en.wikipedia.org/wiki/Leonard_Marshall
update rec_legend_catalog set jersey_number = 36, college = 'Florida State' where id = 'a6cc3009-14ca-4bb7-a6d8-eecf84604a52'; -- Leroy Butler (SS), #36, Florida State; https://en.wikipedia.org/wiki/LeRoy_Butler
update rec_legend_catalog set jersey_number = 44, college = 'Morgan State' where id = '08e3070f-6977-4d40-88c8-b10ae02e76f5'; -- Leroy Kelly (HB), #44, Morgan State; https://en.wikipedia.org/wiki/Leroy_Kelly
update rec_legend_catalog set jersey_number = 91, college = 'Oklahoma State' where id = '33eb0408-4d90-4c35-a6a2-ee94d089f460'; -- Leslie O'Neal (RE), #91, Oklahoma State; https://en.wikipedia.org/wiki/Leslie_O'Neal
update rec_legend_catalog set jersey_number = 37, college = 'Texas A&M' where id = 'a57f84a9-268b-45c1-9719-3b77c548aa33'; -- Lester Hayes (CB), #37, Texas A&M; https://en.wikipedia.org/wiki/Lester_Hayes
update rec_legend_catalog set jersey_number = 51, college = 'USC' where id = '5cc10f51-25d4-4336-8dca-f238073d6498'; -- Lofa Tatupu (MLB), #51, USC; https://en.wikipedia.org/wiki/Lofa_Tatupu
update rec_legend_catalog set jersey_number = 59, college = 'John Carroll' where id = '813b5933-3b1f-4d09-a3ad-7b4405b88423'; -- London Fletcher (MLB), #59, John Carroll; https://en.wikipedia.org/wiki/London_Fletcher
update rec_legend_catalog set college = 'Fresno State' where id = '11916acb-ca31-46c4-b354-7ba7bd8ad99c'; -- Lorenzo Neal (FB), Fresno State; https://en.wikipedia.org/wiki/Lorenzo_Neal
update rec_legend_catalog set jersey_number = 76, college = '1947–1949)' where id = '9daa4ad2-7b25-4521-b019-ab874dbdd7aa'; -- Lou Creekmur (RT), #76, 1947–1949); https://en.wikipedia.org/wiki/Lou_Creekmur
update rec_legend_catalog set jersey_number = 89, college = 'Hartpury College' where id = '14af362c-e9a5-459c-af71-897967b2ce46'; -- Louis Rees-Zammit (HB), #89, Hartpury College; https://en.wikipedia.org/wiki/Louis_Rees-Zammit
update rec_legend_catalog set jersey_number = 78, college = 'Texas A&M' where id = 'e9e3643e-f09c-412e-b3a1-6eccf47da89f'; -- Luke Joeckel (LT), #78, Texas A&M; https://en.wikipedia.org/wiki/Luke_Joeckel
update rec_legend_catalog set jersey_number = 88, college = 'USC' where id = 'a62cb289-6d5a-42cc-a363-6315fa347abd'; -- Lynn Swann (WR), #88, USC; https://en.wikipedia.org/wiki/Lynn_Swann
update rec_legend_catalog set jersey_number = 9, college = 'West Virginia' where id = 'ee539e7b-aece-43f4-9be3-9424e67ff334'; -- Major Harris (QB), #9, West Virginia; https://en.wikipedia.org/wiki/Major_Harris_(American_football)
update rec_legend_catalog set jersey_number = 32, college = 'USC' where id = 'be2b1456-5672-49b6-85c6-e2ddfe543187'; -- Marcus Allen (HB), #32, USC; https://en.wikipedia.org/wiki/Marcus_Allen
update rec_legend_catalog set jersey_number = 34, college = 'Oklahoma' where id = '6da73a1b-c443-46cb-9e47-2f0ef72c58a4'; -- Marcus Dupree (HB), #34, Oklahoma; https://en.wikipedia.org/wiki/Marcus_Dupree
update rec_legend_catalog set jersey_number = 24, college = 'Minnesota' where id = '12c614c6-e0c5-4645-8f8a-9bb43c49fe45'; -- Marion Barber III (HB), #24, Minnesota; https://en.wikipedia.org/wiki/Marion_Barber_III
update rec_legend_catalog set jersey_number = 84, college = 'Notre Dame' where id = '508596a6-c051-4a25-8070-50b313357cc9'; -- Mark Bavaro (TE), #84, Notre Dame; https://en.wikipedia.org/wiki/Mark_Bavaro
update rec_legend_catalog set jersey_number = 99, college = 'East Central' where id = '87ecdeb3-69b1-4f6d-a4be-c8bf43b21a85'; -- Mark Gastineau (RE), #99, East Central; https://en.wikipedia.org/wiki/Mark_Gastineau
update rec_legend_catalog set jersey_number = 7 where id = 'c8ed9752-1384-401f-a5a7-5b38fa32cf55'; -- Mark Harmon (QB), #7; https://en.wikipedia.org/wiki/Mark_Harmon
update rec_legend_catalog set jersey_number = 16, college = 'Washington State' where id = '762f976f-079a-40c5-b13e-d30a35f60676'; -- Mark Rypien (QB), #16, Washington State; https://en.wikipedia.org/wiki/Mark_Rypien
update rec_legend_catalog set jersey_number = 0, college = 'Fort Valley State' where id = '7d833c6a-d94b-493c-ae91-1c51ea6e555f'; -- Marquette King (P), #0, Fort Valley State; https://en.wikipedia.org/wiki/Marquette_King
update rec_legend_catalog set jersey_number = 73, college = 'Iowa' where id = 'e79cdf87-b2bf-442f-ab56-9196ff82e099'; -- Marshal Yanda (RG), #73, Iowa; https://en.wikipedia.org/wiki/Marshal_Yanda
update rec_legend_catalog set college = 'San Diego State' where id = '99ce450f-d629-4674-8777-6a5d38b6a3f1'; -- Marshall Faulk (HB), San Diego State; https://en.wikipedia.org/wiki/Marshall_Faulk
update rec_legend_catalog set jersey_number = 24, college = 'California' where id = 'b63b9168-2e6f-42b3-ac34-59b502242286'; -- Marshawn Lynch (HB), #24, California; https://en.wikipedia.org/wiki/Marshawn_Lynch
update rec_legend_catalog set jersey_number = 93, college = 'Alabama' where id = '4df8213a-578e-40d7-ac1f-f085843bd367'; -- Marty Lyons (DT), #93, Alabama; https://en.wikipedia.org/wiki/Marty_Lyons
update rec_legend_catalog set jersey_number = 11, college = 'USC' where id = '13d83643-4b8f-48c4-823c-34ad98139219'; -- Matt Leinart (QB), #11, USC; https://en.wikipedia.org/wiki/Matt_Leinart
update rec_legend_catalog set jersey_number = 3, college = 'Louisiana Tech' where id = '44288ace-cfb9-443c-873d-4af7d035c5a5'; -- Matt Stover (K), #3, Louisiana Tech; https://en.wikipedia.org/wiki/Matt_Stover
update rec_legend_catalog set jersey_number = 18, college = 'Arkansas' where id = 'cdcbfa60-d7b2-4b66-b05c-84e4c33ab558'; -- Matthew Jones (WR), #18, Arkansas; https://en.wikipedia.org/wiki/Matt_Jones_(wide_receiver)
update rec_legend_catalog set college = 'North Texas State' where id = '73a3f9b1-d323-42a9-9200-056f17ad1877'; -- Mean Joe Greene (DT), North Texas State; https://en.wikipedia.org/wiki/Joe_Greene
update rec_legend_catalog set college = 'Oregon' where id = '1e4c8ff3-9e93-4678-a67e-842d280efdc9'; -- Mel Renfro (CB), Oregon; https://en.wikipedia.org/wiki/Mel_Renfro
update rec_legend_catalog set jersey_number = 74, college = 'Utah State' where id = '8c588f94-c979-44de-8de0-975b21b999e0'; -- Merlin Olsen (DT), #74, Utah State; https://en.wikipedia.org/wiki/Merlin_Olsen
update rec_legend_catalog set jersey_number = 33, college = 'Idaho State' where id = '1b0094c5-faa2-45eb-86f0-b6b7551de560'; -- Merril Hoge (FB), #33, Idaho State; https://en.wikipedia.org/wiki/Merril_Hoge
update rec_legend_catalog set college = 'Miami' where id = '7154cdb7-9941-4100-b893-7cb7fe9dd5ba'; -- Michael Irvin (WR), Miami; https://en.wikipedia.org/wiki/Michael_Irvin
update rec_legend_catalog set college = 'Virginia Tech' where id = '504f40c0-de92-4f46-8f91-fffc421ee6fe'; -- Michael Vick (QB), Virginia Tech; https://en.wikipedia.org/wiki/Michael_Vick
update rec_legend_catalog set jersey_number = 53, college = 'Nebraska' where id = 'bbde4fb3-8848-4267-aece-0bbcef23b800'; -- Mick Tingelhoff (C), #53, Nebraska; https://en.wikipedia.org/wiki/Mick_Tingelhoff
update rec_legend_catalog set college = 'Arizona State' where id = '525d65c2-2fca-4b51-8363-92998f336629'; -- Mike Haynes (CB), Arizona State; https://en.wikipedia.org/wiki/Mike_Haynes_(cornerback)
update rec_legend_catalog set jersey_number = 63, college = 'Penn State' where id = '31a29670-a750-4b83-9335-8357ea3eae4f'; -- Mike Munchak (LG), #63, Penn State; https://en.wikipedia.org/wiki/Mike_Munchak
update rec_legend_catalog set college = 'Baylor' where id = 'cbec60db-66be-42de-9733-030f356dd03a'; -- Mike Singletary (MLB), Baylor; https://en.wikipedia.org/wiki/Mike_Singletary
update rec_legend_catalog set jersey_number = 12, college = 'West Virginia' where id = '5f7d307c-9e1b-42bf-95fe-2a4138241700'; -- Mike Vanderjagt (K), #12, West Virginia; https://en.wikipedia.org/wiki/Mike_Vanderjagt
update rec_legend_catalog set college = 'Wisconsin' where id = 'e19a46f8-34bd-4fd7-8dc9-9552b4ade0ec'; -- Mike Webster (C), Wisconsin; https://en.wikipedia.org/wiki/Mike_Webster
update rec_legend_catalog set jersey_number = 19, college = 'Monmouth' where id = '7db75cc3-cd1c-45ba-98e6-4d638c0dd9e9'; -- Miles Austin (WR), #19, Monmouth; https://en.wikipedia.org/wiki/Miles_Austin
update rec_legend_catalog set jersey_number = 6, college = 'Rutgers' where id = '5115c8eb-1996-4990-9264-bed36d7efdce'; -- Mohamed Sanu (WR), #6, Rutgers; https://en.wikipedia.org/wiki/Mohamed_Sanu
update rec_legend_catalog set jersey_number = 85, college = 'Notre Dame' where id = 'ad91c143-69e1-402c-8368-e341669c45e3'; -- Nick Buoniconti (MLB), #85, Notre Dame; https://en.wikipedia.org/wiki/Nick_Buoniconti
update rec_legend_catalog set jersey_number = 74, college = 'Ohio State' where id = 'cdd1b5a1-7866-409e-adae-63a4b69339df'; -- Nick Mangold (C), #74, Ohio State; https://en.wikipedia.org/wiki/Nick_Mangold
update rec_legend_catalog set college = 'Northwestern State' where id = '294048b6-3cde-44b3-8697-8a618ad936ac'; -- Night Train Lane (CB), Northwestern State; https://en.wikipedia.org/wiki/Jeremy_Lane
update rec_legend_catalog set jersey_number = 28, college = 'California' where id = 'da70645d-6af5-48e6-8860-f10892ffa569'; -- Nnamdi Asomugha (CB), #28, California; https://en.wikipedia.org/wiki/Nnamdi_Asomugha
update rec_legend_catalog set jersey_number = 21, college = 'Kansas' where id = '6843da72-6d93-4f3a-a11f-834368ba59a0'; -- Nolan Cromwell (FS), #21, Kansas; https://en.wikipedia.org/wiki/Nolan_Cromwell
update rec_legend_catalog set college = 'USC' where id = 'befb7afb-1d33-45e7-b015-444aa3f63e17'; -- O.J. Simpson (HB), USC; https://en.wikipedia.org/wiki/O._J._Simpson
update rec_legend_catalog set jersey_number = 50, college = 'Washington' where id = '40ec886b-f2d0-4b81-b826-2ce0072535a2'; -- Olin Kreutz (C), #50, Washington; https://en.wikipedia.org/wiki/Olin_Kreutz
update rec_legend_catalog set jersey_number = 89, college = 'Prairie View A&M' where id = '33ffa017-0bec-4349-9e0e-c4e415f217af'; -- Otis Taylor (WR), #89, Prairie View A&M; https://en.wikipedia.org/wiki/Otis_Taylor_(American_football)
update rec_legend_catalog set jersey_number = 50, college = 'Louisville' where id = 'cbf30ceb-7acf-4847-a157-e22392493f0e'; -- Otis Wilson (LOLB), #50, Louisville; https://en.wikipedia.org/wiki/Otis_Wilson
update rec_legend_catalog set college = 'Alabama' where id = '81655ce9-5ef4-4059-8fd0-495e919da289'; -- Ozzie Newsome (TE), Alabama; https://en.wikipedia.org/wiki/Ozzie_Newsome
update rec_legend_catalog set jersey_number = 1, college = 'West Virginia' where id = '39832573-d31a-4179-9af5-51b85d62c939'; -- Pat McAfee (P), #1, West Virginia; https://en.wikipedia.org/wiki/Pat_McAfee
update rec_legend_catalog set college = 'Iowa' where id = 'fc366e39-d530-4d20-850a-ce4d5607417e'; -- Paul Krause (FS), Iowa; https://en.wikipedia.org/wiki/Paul_Krause
update rec_legend_catalog set jersey_number = 42, college = 'Ohio State' where id = 'a0e8df88-ce87-4168-94ae-a593825f9c47'; -- Paul Warfield (WR), #42, Ohio State; https://en.wikipedia.org/wiki/Paul_Warfield
update rec_legend_catalog set college = 'Memphis' where id = '5e7b8d81-042a-4b3d-85d9-f1ceed557340'; -- Paxton Lynch (QB), Memphis; https://en.wikipedia.org/wiki/Paxton_Lynch
update rec_legend_catalog set jersey_number = 99, college = 'Ohio State' where id = '071006ec-e92d-4b81-a5de-c4620f2254e5'; -- Pepper Johnson (MLB), #99, Ohio State; https://en.wikipedia.org/wiki/Pepper_Johnson
update rec_legend_catalog set jersey_number = 81, college = 'Florida State' where id = '72a0d43a-fcad-4ec3-82c5-8968e45583d6'; -- Peter Warrick (WR), #81, Florida State; https://en.wikipedia.org/wiki/Peter_Warrick
update rec_legend_catalog set jersey_number = 33, college = 'Arkansas' where id = '96eed18c-6255-4f8e-b650-06504b0ef8c8'; -- Peyton Hillis (HB), #33, Arkansas; https://en.wikipedia.org/wiki/Peyton_Hillis
update rec_legend_catalog set college = 'Tennessee' where id = '160ad534-72c6-4e7a-a065-b514c1fd8cd2'; -- Peyton Manning (QB), Tennessee; https://en.wikipedia.org/wiki/Peyton_Manning
update rec_legend_catalog set jersey_number = 9, college = 'Texas' where id = 'e31f7281-6008-496d-be73-f46c3ec64056'; -- Phil Dawson (K), #9, Texas; https://en.wikipedia.org/wiki/Phil_Dawson
update rec_legend_catalog set jersey_number = 17, college = 'NC State' where id = '03aaa9e5-b31c-4e6e-afe0-5d1905f19f8c'; -- Philip Rivers (QB), #17, NC State; https://en.wikipedia.org/wiki/Philip_Rivers
update rec_legend_catalog set jersey_number = 31, college = 'Texas' where id = '6f4abd8d-f33d-475f-89b6-096bc145a9f4'; -- Priest Holmes (HB), #31, Texas; https://en.wikipedia.org/wiki/Priest_Holmes
update rec_legend_catalog set jersey_number = 1, college = 'UNLV' where id = '2585c872-111b-4f00-afa0-760954790a3b'; -- Randall Cunningham (QB), #1, UNLV; https://en.wikipedia.org/wiki/Randall_Cunningham
update rec_legend_catalog set jersey_number = 64, college = 'Arizona State' where id = '085eb62e-9b25-45af-9e48-84d4241bf945'; -- Randall McDaniel (LG), #64, Arizona State; https://en.wikipedia.org/wiki/Randall_McDaniel
update rec_legend_catalog set jersey_number = 51, college = 'UCLA' where id = '50843eaa-b33c-4581-a1cb-95ed51fc1d3b'; -- Randy Cross (C), #51, UCLA; https://en.wikipedia.org/wiki/Randy_Cross
update rec_legend_catalog set jersey_number = 54, college = 'Maryland' where id = 'b627d143-67ed-4380-bf9c-5345e1858562'; -- Randy White (DT), #54, Maryland; https://en.wikipedia.org/wiki/Randy_White_(American_football)
update rec_legend_catalog set jersey_number = 29, college = 'Colorado' where id = '5e326038-edb8-4551-ac7d-079ac6de5a08'; -- Rashaan Salaam (HB), #29, Colorado; https://en.wikipedia.org/wiki/Rashaan_Salaam
update rec_legend_catalog set jersey_number = 81, college = 'Oklahoma State' where id = '9a1104c4-66ce-4e24-aaad-b104dfa1b603'; -- Rashaun Woods (WR), #81, Oklahoma State; https://en.wikipedia.org/wiki/Rashaun_Woods
update rec_legend_catalog set jersey_number = 70, college = 'Fort Valley State' where id = 'dd5f0f69-ceb2-4f05-b2bf-4e05fc54d42c'; -- Rayfield Wright (RT), #70, Fort Valley State; https://en.wikipedia.org/wiki/Rayfield_Wright
update rec_legend_catalog set jersey_number = 82, college = 'SMU' where id = '94298171-e32b-4440-94c1-607bd3190867'; -- Raymond Berry (WR), #82, SMU; https://en.wikipedia.org/wiki/Raymond_Berry
update rec_legend_catalog set jersey_number = 11, college = 'Washington' where id = '93b4dab7-37ae-4a76-a42b-485803884dee'; -- Reggie Williams (WR), #11, Washington; https://en.wikipedia.org/wiki/Reggie_Williams_(wide_receiver)
update rec_legend_catalog set jersey_number = 96, college = 'Tennessee State' where id = '617cdf3c-3ed6-4785-b6a2-9110183ee4e0'; -- Richard Dent (RE), #96, Tennessee State; https://en.wikipedia.org/wiki/Richard_Dent
update rec_legend_catalog set jersey_number = 5, college = 'Stanford' where id = '6134519b-cdab-43e0-b7ce-a057b1a7fb9e'; -- Richard Sherman (CB), #5, Stanford; https://en.wikipedia.org/wiki/Richard_Sherman_(American_football)
update rec_legend_catalog set jersey_number = 78, college = 'Texas A&M' where id = 'e87d3427-a060-4ee5-a33d-a7639a4ff736'; -- Richmond Webb (LT), #78, Texas A&M; https://en.wikipedia.org/wiki/Richmond_Webb
update rec_legend_catalog set jersey_number = 5, college = 'Notre Dame' where id = 'cacdba32-6c2c-4d32-be8f-4714141260c2'; -- Rick Mirer (QB), #5, Notre Dame; https://en.wikipedia.org/wiki/Rick_Mirer
update rec_legend_catalog set jersey_number = 88, college = 'Ohio State' where id = '59829008-3d39-402e-baf4-cfa3ad0fc65c'; -- Rickey Dudley (TE), #88, Ohio State; https://en.wikipedia.org/wiki/Rickey_Dudley
update rec_legend_catalog set jersey_number = 57, college = 'Pitt' where id = '755a7bbb-4ce2-421f-ac25-0c7624bf6df4'; -- Rickey Jackson (ROLB), #57, Pitt; https://en.wikipedia.org/wiki/Rickey_Jackson
update rec_legend_catalog set college = 'Arizona' where id = '53f45537-9285-4e5a-9ac6-a591306e84ec'; -- Rob Gronkowski (TE), Arizona; https://en.wikipedia.org/wiki/Rob_Gronkowski
update rec_legend_catalog set jersey_number = 52, college = 'Jackson State' where id = '76458a97-0b0d-4af1-b1e2-185723f5f850'; -- Robert Brazile (ROLB), #52, Jackson State; https://en.wikipedia.org/wiki/Robert_Brazile
update rec_legend_catalog set jersey_number = 72, college = 'Iowa' where id = '7a88f7ac-2887-4d3f-9159-34fb963114be'; -- Robert Gallery (LT), #72, Iowa; https://en.wikipedia.org/wiki/Robert_Gallery
update rec_legend_catalog set jersey_number = 3, college = 'Baylor' where id = '3795d6a7-2db0-4767-8828-a6a0e2d6c19c'; -- Robert Griffin III (QB), #3, Baylor; https://en.wikipedia.org/wiki/Robert_Griffin_III
update rec_legend_catalog set jersey_number = 19, college = 'Florida State' where id = '9ff85670-0706-4ffa-93e8-233ed7da1fba'; -- Roberto Aguayo (K), #19, Florida State; https://en.wikipedia.org/wiki/Roberto_Aguayo
update rec_legend_catalog set college = 'Purdue' where id = '96ad5773-f83c-4522-a1af-b79e18f29c8b'; -- Rod Woodson (CB), Purdue; https://en.wikipedia.org/wiki/Rod_Woodson
update rec_legend_catalog set jersey_number = 22, college = 'Nebraska' where id = 'cbeb62d9-4f3e-4dea-aec6-7d558a148d25'; -- Roger Craig (HB), #22, Nebraska; https://en.wikipedia.org/wiki/Roger_Craig_(American_football)
update rec_legend_catalog set jersey_number = 22, college = 'Missouri' where id = '4587425a-bbc6-422c-bbea-57f5b3e1b017'; -- Roger Wehrli (CB), #22, Missouri; https://en.wikipedia.org/wiki/Roger_Wehrli
update rec_legend_catalog set jersey_number = 36, college = 'Wisconsin' where id = 'daa835c8-4ab0-4183-8e49-26c28e71d778'; -- Ron Dayne (HB), #36, Wisconsin; https://en.wikipedia.org/wiki/Ron_Dayne
update rec_legend_catalog set jersey_number = 77, college = 'USC' where id = '0e8b702e-9bf1-4022-9cf6-528e2ecab242'; -- Ron Mix (RT), #77, USC; https://en.wikipedia.org/wiki/Ron_Mix
update rec_legend_catalog set jersey_number = 73, college = 'USC' where id = '71b064b9-161e-419d-b6e4-14d69cabbd3e'; -- Ron Yary (RT), #73, USC; https://en.wikipedia.org/wiki/Ron_Yary
update rec_legend_catalog set jersey_number = 20, college = 'Virginia' where id = 'e2b25f18-d412-4df4-91db-20cbbbbbb3cc'; -- Ronde Barber (CB), #20, Virginia; https://en.wikipedia.org/wiki/Ronde_Barber
update rec_legend_catalog set jersey_number = 79, college = 'Morgan State' where id = '9ccec0dd-5d81-4c69-88bf-853c286a32a9'; -- Roosevelt Brown (LT), #79, Morgan State; https://en.wikipedia.org/wiki/Rosey_Brown
update rec_legend_catalog set jersey_number = 45 where id = 'a812f413-6204-42a7-9adb-50f90fe28bde'; -- Rudy Ruettiger (RE), #45; https://en.wikipedia.org/wiki/Rudy_Ruettiger
update rec_legend_catalog set jersey_number = 68, college = 'Pitt' where id = '95626f52-1db3-410c-94f4-7580c04d32d7'; -- Russ Grimm (LG), #68, Pitt; https://en.wikipedia.org/wiki/Russ_Grimm
update rec_legend_catalog set jersey_number = 4, college = 'Harvard' where id = '8614461c-8494-4630-a44a-8c512245f47f'; -- Ryan Fitzpatrick (QB), #4, Harvard; https://en.wikipedia.org/wiki/Ryan_Fitzpatrick
update rec_legend_catalog set jersey_number = 16, college = 'Washington State' where id = '8504fe94-1fad-47d6-92c0-8af3e07c6276'; -- Ryan Leaf (QB), #16, Washington State; https://en.wikipedia.org/wiki/Ryan_Leaf
update rec_legend_catalog set jersey_number = 33, college = 'TCU' where id = '333cab63-3d67-4dd5-b73d-d2c749e882dd'; -- Sammy Baugh (QB), #33, TCU; https://en.wikipedia.org/wiki/Sammy_Baugh
update rec_legend_catalog set jersey_number = 55, college = 'Illinois' where id = '32110a90-62c6-430c-8e23-ccddfb634707'; -- Scott Studwell (MLB), #55, Illinois; https://en.wikipedia.org/wiki/Scott_Studwell
update rec_legend_catalog set college = 'Miami' where id = 'b2f07280-50ca-49ae-a5f4-c5f136023d8b'; -- Sean Taylor (SS), Miami; https://en.wikipedia.org/wiki/Sean_Taylor
update rec_legend_catalog set hand = 'Left', jersey_number = 11, college = 'Florida State' where id = 'e8c75900-55bf-476a-8a1f-289df2c943e4'; -- Sebastian Janikowski (K), hand, #11, Florida State; https://en.wikipedia.org/wiki/Sebastian_Janikowski
update rec_legend_catalog set college = 'Savannah State' where id = 'a8ab7273-9c65-4ed3-9382-e28d79c7c3e6'; -- Shannon Sharpe (TE), Savannah State; https://en.wikipedia.org/wiki/Shannon_Sharpe
update rec_legend_catalog set jersey_number = 37, college = 'Alabama' where id = '54fd71ad-3bdf-40e7-8b76-b7b71874a8c9'; -- Shaun Alexander (HB), #37, Alabama; https://en.wikipedia.org/wiki/Shaun_Alexander
update rec_legend_catalog set jersey_number = 42, college = 'Columbia' where id = '952a2b80-01b8-442d-8f63-09488fee3cce'; -- Sid Luckman (QB), #42, Columbia; https://en.wikipedia.org/wiki/Sid_Luckman
update rec_legend_catalog set jersey_number = 78, college = 'Illinois' where id = '7c7c4b93-bef6-4909-90c8-598cb51d683d'; -- Simeon Rice (RE), #78, Illinois; https://en.wikipedia.org/wiki/Simeon_Rice
update rec_legend_catalog set jersey_number = 9, college = 'Duke' where id = '3839a1a0-c70a-46ae-b65d-b63f8de327b2'; -- Sonny Jurgensen (QB), #9, Duke; https://en.wikipedia.org/wiki/Sonny_Jurgensen
update rec_legend_catalog set jersey_number = 73, college = 'Maryland' where id = 'd6f49dfb-00d1-4484-9096-73e057f5a19c'; -- Stan Jones (LG), #73, Maryland; https://en.wikipedia.org/wiki/Stan_Jones_(American_football)
update rec_legend_catalog set jersey_number = 84, college = 'South Carolina' where id = 'd8b494a0-8f22-4879-a722-3a9e485f5ea0'; -- Sterling Sharpe (WR), #84, South Carolina; https://en.wikipedia.org/wiki/Sterling_Sharpe
update rec_legend_catalog set college = 'Arkansas' where id = '7b031dec-c8a2-4aba-985b-7155520e43d0'; -- Steve Atwater (SS), Arkansas; https://en.wikipedia.org/wiki/Steve_Atwater
update rec_legend_catalog set jersey_number = 94, college = 'Washington' where id = '0e59dd57-0def-4fb8-ac0d-ea3cee2998e2'; -- Steve Emtman (DT), #94, Washington; https://en.wikipedia.org/wiki/Steve_Emtman
update rec_legend_catalog set jersey_number = 89, college = 'Utah' where id = 'ea4b7382-d4cd-4d94-8a1e-910fc61cbe29'; -- Steve Smith Sr. (WR), #89, Utah; https://en.wikipedia.org/wiki/Steve_Smith_Sr.
update rec_legend_catalog set jersey_number = 76, college = 'Penn State' where id = 'ec630add-d4b0-463c-b91b-9a5a5b83c82a'; -- Steve Wisniewski (LG), #76, Penn State; https://en.wikipedia.org/wiki/Steve_Wisniewski
update rec_legend_catalog set college = 'BYU' where id = '16702b5c-ad29-48f8-ac3d-e50a4171975d'; -- Steve Young (QB), BYU; https://en.wikipedia.org/wiki/Steve_Young
update rec_legend_catalog set jersey_number = 39, college = 'Oregon State' where id = '6a8925ce-1816-4453-8c7a-b3af49eb625e'; -- Steven Jackson (HB), #39, Oregon State; https://en.wikipedia.org/wiki/Steven_Jackson
update rec_legend_catalog set jersey_number = 18, college = 'Abilene Christian' where id = '314acc16-8b6c-4383-acfc-9a6ed00c1865'; -- Taylor Gabriel (WR), #18, Abilene Christian; https://en.wikipedia.org/wiki/Taylor_Gabriel
update rec_legend_catalog set college = 'Miami' where id = 'c80765ba-7717-45f1-9c48-4d5842014c58'; -- Ted Hendricks (LOLB), Miami; https://en.wikipedia.org/wiki/Ted_Hendricks
update rec_legend_catalog set college = 'Chattanooga' where id = '6e371621-79ef-453a-9798-025fe99f0e61'; -- Terrell Owens (WR), Chattanooga; https://en.wikipedia.org/wiki/Terrell_Owens
update rec_legend_catalog set jersey_number = 59, college = 'Western Michigan' where id = '3bc8b97f-8aa7-4418-90a1-6637d08e5970'; -- Terry Crews (RE), #59, Western Michigan; https://en.wikipedia.org/wiki/Terry_Crews
update rec_legend_catalog set jersey_number = 36, college = 'Tennessee' where id = 'fcf13570-5f51-4520-9dc4-0005f939f9eb'; -- Terry McDaniel (CB), #36, Tennessee; https://en.wikipedia.org/wiki/Terry_McDaniel
update rec_legend_catalog set jersey_number = 34, college = 'Oklahoma State' where id = 'e6e2eac7-38dc-473b-a907-bcf4b52ee18e'; -- Thurman Thomas (HB), #34, Oklahoma State; https://en.wikipedia.org/wiki/Thurman_Thomas
update rec_legend_catalog set jersey_number = 21, college = 'Virginia' where id = 'cfb25556-7875-4511-aa23-3ec3e76b0a70'; -- Tiki Barber (HB), #21, Virginia; https://en.wikipedia.org/wiki/Tiki_Barber
update rec_legend_catalog set jersey_number = 81, college = 'Notre Dame' where id = '0621bb5a-8948-4bea-bca5-14689519091d'; -- Tim Brown (WR), #81, Notre Dame; https://en.wikipedia.org/wiki/Tim_Brown_(American_football)
update rec_legend_catalog set jersey_number = 2, college = 'Kentucky' where id = '1256fce5-1c79-461e-90c7-5627822b7cae'; -- Tim Couch (QB), #2, Kentucky; https://en.wikipedia.org/wiki/Tim_Couch
update rec_legend_catalog set hand = 'Left', jersey_number = 15, college = 'Florida' where id = '2d34fc4d-ee88-4d24-8585-e8e9d3c6b859'; -- Tim Tebow (QB), hand, #15, Florida; https://en.wikipedia.org/wiki/Tim_Tebow
update rec_legend_catalog set jersey_number = 46, college = 'BYU' where id = '97edf9be-d9ba-41aa-a739-19d347e3c454'; -- Todd Christensen (TE), #46, BYU; https://en.wikipedia.org/wiki/Todd_Christensen
update rec_legend_catalog set hand = 'Left' where id = 'f8654f32-6ea6-4d06-b467-a74a6987feb3'; -- Todd Helton (QB), hand; https://en.wikipedia.org/wiki/Todd_Helton
update rec_legend_catalog set jersey_number = 19, college = 'USC' where id = '5effcaa6-aee0-4571-a187-fb950377a7e9'; -- Todd Marinovich (QB), #19, USC; https://en.wikipedia.org/wiki/Todd_Marinovich
update rec_legend_catalog set college = 'Michigan' where id = '7542243f-5b56-48fa-9411-6999863a61a6'; -- Tom Brady (QB), Michigan; https://en.wikipedia.org/wiki/Tom_Brady
update rec_legend_catalog set jersey_number = 40, college = 'Colorado' where id = 'ce6268c1-881d-477d-9385-0a84d20d5b0c'; -- Tom Brookshier (CB), #40, Colorado; https://en.wikipedia.org/wiki/Tom_Brookshier
update rec_legend_catalog set jersey_number = 65, college = 'Michigan' where id = 'a9160e29-7200-4ffc-a862-c798920dc8a2'; -- Tom Mack (LG), #65, Michigan; https://en.wikipedia.org/wiki/Tom_Mack
update rec_legend_catalog set college = 'Boston College' where id = '8378d7fa-7861-416b-b1ba-7e0e66a46a73'; -- Tom Nalen (C), Boston College; https://en.wikipedia.org/wiki/Tom_Nalen
update rec_legend_catalog set jersey_number = 44, college = 'Nebraska' where id = '5e460f0b-2005-40ca-90e7-c369804e472f'; -- Tom Rathman (FB), #44, Nebraska; https://en.wikipedia.org/wiki/Tom_Rathman
update rec_legend_catalog set jersey_number = 15, college = 'Nebraska' where id = '72ed14fb-71ba-4567-a632-28f630a330e4'; -- Tommie Frazier (QB), #15, Nebraska; https://en.wikipedia.org/wiki/Tommie_Frazier
update rec_legend_catalog set college = 'USC' where id = '9aaaab40-79a4-4590-96f1-cfaf3dab8095'; -- Tony Boselli (LT), USC; https://en.wikipedia.org/wiki/Tony_Boselli
update rec_legend_catalog set jersey_number = 3, college = 'Gonzaga' where id = '5450337c-19bf-4c46-aa82-a3b67a0cb380'; -- Tony Canadeo (HB), #3, Gonzaga; https://en.wikipedia.org/wiki/Tony_Canadeo
update rec_legend_catalog set jersey_number = 79, college = 'Michigan State' where id = '47e438ab-3d97-4b68-8b05-7723dffc5a9c'; -- Tony Mandarich (LT), #79, Michigan State; https://en.wikipedia.org/wiki/Tony_Mandarich
update rec_legend_catalog set jersey_number = 98, college = 'Pitt' where id = 'd2ce45e6-f749-4915-9206-2318aef63ac1'; -- Tony Siragusa (DT), #98, Pitt; https://en.wikipedia.org/wiki/Tony_Siragusa
update rec_legend_catalog set jersey_number = 34, college = 'Alabama' where id = 'bbde7da1-f9f9-4d73-baec-7e9c1369f6ff'; -- Trent Richardson (HB), #34, Alabama; https://en.wikipedia.org/wiki/Trent_Richardson
update rec_legend_catalog set college = 'UCLA' where id = 'd185300d-caa5-4f35-9a61-2e93cf466f77'; -- Troy Aikman (QB), UCLA; https://en.wikipedia.org/wiki/Troy_Aikman
update rec_legend_catalog set college = 'USC' where id = '0a46fd3f-f018-457f-81a5-12d732087217'; -- Troy Polamalu (SS), USC; https://en.wikipedia.org/wiki/Troy_Polamalu
update rec_legend_catalog set jersey_number = 1, college = 'Ohio State' where id = '79bd3f46-4b06-42ea-9ac5-12271cba8eb8'; -- Troy Smith (QB), #1, Ohio State; https://en.wikipedia.org/wiki/Troy_Smith
update rec_legend_catalog set jersey_number = 84, college = 'South Carolina' where id = '5817e6b5-3a76-40b5-9c6a-c2204118dd74'; -- Troy Williamson (WR), #84, South Carolina; https://en.wikipedia.org/wiki/Troy_Williamson
update rec_legend_catalog set jersey_number = 14, college = 'BYU' where id = 'd6058795-0166-4abf-81fc-36929c80ff92'; -- Ty Detmer (QB), #14, BYU; https://en.wikipedia.org/wiki/Ty_Detmer
update rec_legend_catalog set jersey_number = 50, college = 'Ohio State' where id = 'cd3c0d59-f913-4c88-a736-aaff77a61238'; -- Vernon Gholston (RE), #50, Ohio State; https://en.wikipedia.org/wiki/Vernon_Gholston
update rec_legend_catalog set jersey_number = 83, college = 'Saint Joseph''s' where id = 'ce84df94-c636-4226-a2ea-eff4b6802418'; -- Vince Papale (WR), #83, Saint Joseph's; https://en.wikipedia.org/wiki/Vince_Papale
update rec_legend_catalog set jersey_number = 16, college = 'Miami' where id = '19f26fed-db16-43ad-931a-d461b7c36abf'; -- Vinny Testaverde (QB), #16, Miami; https://en.wikipedia.org/wiki/Vinny_Testaverde
update rec_legend_catalog set jersey_number = 71, college = 'Florida State' where id = '6f1b9d27-5a3e-4328-b346-7b1b2abcb693'; -- Walter Jones (LT), #71, Florida State; https://en.wikipedia.org/wiki/Walter_Jones_(American_football)
update rec_legend_catalog set college = 'Jackson State' where id = '1a96230b-601b-44b9-a293-b1df3a029887'; -- Walter Payton (HB), Jackson State; https://en.wikipedia.org/wiki/Walter_Payton
update rec_legend_catalog set college = 'Washington' where id = '399ea64c-6f57-42a0-9c6d-a194845b8c8b'; -- Warren Moon (QB), Washington; https://en.wikipedia.org/wiki/Warren_Moon
update rec_legend_catalog set college = 'Texas Tech' where id = 'd2a7debf-9f5e-410d-9759-2e0b6d39d335'; -- Wes Welker (WR), Texas Tech; https://en.wikipedia.org/wiki/Wes_Welker
update rec_legend_catalog set jersey_number = 68, college = 'Nebraska' where id = '0d12bef4-7820-4499-98cd-4087b91c6f4c'; -- Will Shields (RG), #68, Nebraska; https://en.wikipedia.org/wiki/Will_Shields
update rec_legend_catalog set jersey_number = 95, college = 'Clemson' where id = '606e267d-18ee-4c9d-abb2-d94483fcd137'; -- William "Refrigerator" Perry (DT), #95, Clemson; https://en.wikipedia.org/wiki/William_Perry_(American_football)
update rec_legend_catalog set jersey_number = 79, college = 'Auburn' where id = 'fb3d53cd-103e-452e-b507-4c38a2f8cc8b'; -- Willie Anderson (RT), #79, Auburn; https://en.wikipedia.org/wiki/Willie_Anderson_(offensive_tackle)
update rec_legend_catalog set jersey_number = 24, college = 'Grambling' where id = '7fca6351-7349-4deb-befe-7b5f9e75a6c7'; -- Willie Brown (CB), #24, Grambling; https://en.wikipedia.org/wiki/Willie_Brown_(American_football)
update rec_legend_catalog set jersey_number = 24, college = 'USC' where id = '1bef7ea3-47f3-4145-97cd-6a1f1c24c608'; -- Willie Wood (FS), #24, USC; https://en.wikipedia.org/wiki/Willie_Wood
update rec_legend_catalog set jersey_number = 14, college = 'LSU' where id = '7343e683-6915-4283-a986-60957d7fc00a'; -- Y.A. Tittle (QB), #14, LSU; https://en.wikipedia.org/wiki/Y._A._Tittle
update rec_legend_catalog set jersey_number = 55, college = 'Texas Tech' where id = 'b3168b54-2765-4e15-bbea-e92a300fea57'; -- Zach Thomas (MLB), #55, Texas Tech; https://en.wikipedia.org/wiki/Zach_Thomas
update rec_legend_catalog set jersey_number = 70, college = 'Notre Dame' where id = 'a174755e-5d2e-4ea6-ae4c-1937dfe952a1'; -- Zack Martin (RG), #70, Notre Dame; https://en.wikipedia.org/wiki/Zack_Martin
