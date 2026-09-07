// Pass 10: the Owner tree merged into RiseProgression.tsx's unified "Build Your Legacy" identity
// switcher (Owner is now just another identity tab there, not a separate page) -- this route is
// kept only as a redirect for any bookmarked/old link.
import { Navigate, useParams } from "react-router-dom";

export function RiseTrustTreePage() {
  const { leagueId = "" } = useParams();
  return <Navigate replace to={`/l/${leagueId}/team/progression?identity=owner`} />;
}
