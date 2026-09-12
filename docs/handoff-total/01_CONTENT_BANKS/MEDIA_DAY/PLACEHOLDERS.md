# Placeholder Contract

Core: `{owner_name}` `{team_name}` `{team_city}` `{team_abbr}` `{media_personality}`

Season: `{season_number}` `{stage_name}` `{week_number}` `{record}` `{last_season_record}` `{rank}` `{conference_rank}` `{division_rank}` `{playoff_seed}`

Trends: `{win_streak}` `{loss_streak}` `{last3_record}` `{last5_record}` `{trend_stat_label}` `{trend_stat_value}` `{league_rank_in_stat}`

Players: `{player_name}` `{player_position}` `{player_stat_line}` `{player_age}` `{player_ovr}` `{player_dev}` `{rookie_name}` `{rookie_ovr}`

Contracts/roster: `{re_sign_player}` `{departed_player}` `{cap_space}` `{team_need}` `{position_group}`

FA: `{pre_fa_priority}` `{pre_fa_quote}` `{fa_target_name}` `{signed_player_name}` `{signed_player_position}` `{signed_player_ovr}`

Draft: `{draft_pick_number}` `{draft_target_position}` `{drafted_player_name}` `{drafted_player_ovr}`

Matchup: `{opponent_team}` `{opponent_hot_player}` `{opponent_hot_player_stat}` `{prior_meeting_result}` `{game_consequence}`

## Rendering rule
Never render a template when a listed `requires` value is null/unresolved. Pick another eligible template. Do not substitute `N/A` into public copy.
