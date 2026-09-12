# Data Accuracy and Routing Rules ## Explicitly ignored player raw data
Do not use for media/context:
- draftRound
- draftPick
- legacyScore This does not prohibit league draft-pick assets or the current/future rookie draft process; it only excludes those imported player-history fields. ## Verified useful raw player context
Use with provenance adapter until normalized:
- desiredSalary / desiredBonus / desiredLength
- reSignStatus
- contractSalary / contractBonus / contractLength / contractYearsLeft
- capHit / capReleasePenalty / capReleaseNetSavings (non-RTI only where salary-cap rules are meaningful)
- yearsPro / rookieYear
- productionGrade / physicalGrade / intangibleGrade / durabilityGrade
- injuryType / injuryLength
- experiencePoints / skillPoints
- playerBestOvr / playerSchemeOvr / teamSchemeOvr
- rosterGoalList / signatureSlotList
- ratings and traits ## Morale
Not present in reviewed current raw player payloads. Never use as imported fact. ## Unsupported / blocked
- snap counts or downs played
- reliable kick/punt return production from reviewed Season 1
- defender-specific receiving TDs allowed
- pressure rate / QB hits
- routes run / targets
- blitz rate
- man/zone usage
- play-action usage
- imported coaching identities ## RTI economy separation
Never use Madden salary-cap pressure or native re-sign demands as an RTI owner premise. RTI's custom-player REC contract system is the authoritative economic story.
