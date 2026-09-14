/** My Team page's read-only records row: season / postseason / career / career postseason. */
export function MyTeamRecordRow({
  my,
  profile,
}: {
  my: {
    leagueSeasonRecordText?: string | null;
    leagueSeasonPlayoffText?: string | null;
  };
  profile: {
    globalRecord?: { text?: string | null; playoffText?: string | null } | null;
  };
}) {
  return (
    <div className="hub-my-team-record-row">
      <article><span>Season record</span><strong>{my.leagueSeasonRecordText ?? "0-0-0"}</strong></article>
      <article><span>Post-season record</span><strong>{my.leagueSeasonPlayoffText ?? "0-0"}</strong></article>
      <article><span>Career record</span><strong>{profile.globalRecord?.text ?? "0-0-0"}</strong></article>
      <article><span>Career post-season (SB)</span><strong>{profile.globalRecord?.playoffText ?? "0-0"}{profile.globalRecord?.superbowlText ? ` (${profile.globalRecord.superbowlText})` : ""}</strong></article>
    </div>
  );
}
