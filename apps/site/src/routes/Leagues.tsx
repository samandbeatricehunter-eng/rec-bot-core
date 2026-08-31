import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { NFL_TEAMS } from "@rec/shared";
import { useAuth } from "../lib/auth-context.js";
import { useHub } from "../lib/hub-context.js";
import {
  siteApi,
  type EntitlementSummary,
  type SiteLeagueInvitePending,
  type SiteLeagueSearchFilters,
  type SiteLeagueSearchHit,
  type SiteLeagueSummary,
  type SiteOpenTeam,
} from "../lib/site-api.js";
import { CreateLeagueWizard } from "../components/CreateLeagueWizard.js";
import { LEAGUE_TEMPLATES, MADDEN_LEAGUE_TEMPLATES } from "../lib/league-templates.js";

const ROSTER_TYPE_OPTIONS = [
  { value: "", label: "Any roster type" },
  { value: "fantasy_draft", label: "Fantasy Draft" },
  { value: "regular_rosters", label: "Regs" },
  { value: "rise_to_immortality", label: "Rise to Immortality" },
];

type Tab = "search" | "mine";

const STANDARD_REC_4TH =
  "Standard REC: past midfield on 4th & 3 or shorter; trailing in the second half may go anytime.";

const MADDEN_DIFFICULTY = [
  { value: "", label: "Any difficulty" },
  { value: "all_madden", label: "All-Madden" },
  { value: "all_pro", label: "All-Pro" },
  { value: "pro", label: "Pro" },
  { value: "rookie", label: "Rookie" },
];

const STREAM_OPTIONS = [
  { value: "", label: "Any streaming rule" },
  { value: "required", label: "Streaming required" },
  { value: "recommended", label: "Streaming recommended" },
  { value: "disabled", label: "Streaming not required" },
];

const TRADE_OPTIONS = [
  { value: "", label: "Any trade rules" },
  { value: "no_approval_required", label: "No approval required" },
  { value: "commissioner_review", label: "Commissioner review" },
  { value: "competition_committee_review", label: "Competition committee review" },
];

const SORT_OPTIONS = [
  { value: "name_asc", label: "Name A-Z" },
  { value: "name_desc", label: "Name Z-A" },
  { value: "open_teams", label: "Most open teams" },
  { value: "newest", label: "Newest" },
];

// The league owner's one-time Discord bot setup — the /discord-guild-picker page grants a
// fresh "guilds" OAuth scope to list servers the user can actually install the bot into (so
// they pick the right one from a dropdown), pre-targets the invite link at that server, then
// walks through the server-owner-only /claim-league step that actually links it to this league.
function ConnectDiscordCard({ league }: { league: SiteLeagueSummary }) {
  return (
    <div className="site-league-card-discord" onClick={(e) => e.stopPropagation()}>
      <Link
        className="site-btn site-btn-ghost"
        to={`/discord-guild-picker?leagueId=${league.id}&next=${encodeURIComponent("/leagues?tab=mine")}`}
      >
        Connect a Discord Server
      </Link>
    </div>
  );
}

function roleLabel(league: SiteLeagueSummary) {
  const role = league.commissionerRole ?? (league.isCommissioner ? "co" : "member");
  if (role === "head") return "Head Commish";
  if (role === "co") return "Co-Commish";
  return "Member";
}

function boolTri(value: "" | "true" | "false"): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function isCfbGame(game: string) {
  return game === "cfb_27";
}

function consoleLabel(console: string) {
  return console === "ps5" ? "PS5" : console === "xbox" ? "Xbox" : console === "pc" ? "PC" : console;
}

// This page only ever searches Madden 27 leagues, so the open-team picker is always NFL teams.
function teamOptionsForGame() {
  return [...NFL_TEAMS]
    .map((team) => ({
      value: team.abbreviation,
      label: team.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function yesNo(value: boolean | null | undefined) {
  return value ? "Yes" : "No";
}

function onOff(value: boolean | null | undefined) {
  return value ? "On" : "Off";
}

function streamingLabel(value: string | null | undefined) {
  if (!value) return "-";
  if (value === "disabled") return "Not required";
  if (value === "required") return "Required";
  if (value === "recommended") return "Recommended";
  return value.replaceAll("_", " ");
}

function difficultyLabel(value: string | null | undefined, game: string) {
  if (!value) return "-";
  if (isCfbGame(game)) {
    const map: Record<string, string> = {
      rookie: "Freshman",
      pro: "Varsity",
      all_pro: "All-American",
      all_madden: "Heisman",
    };
    return map[value] ?? value.replaceAll("_", " ");
  }
  const map: Record<string, string> = {
    rookie: "Rookie",
    pro: "Pro",
    all_pro: "All-Pro",
    all_madden: "All-Madden",
  };
  return map[value] ?? value.replaceAll("_", " ");
}

function injuryLabel(value: string | null | undefined) {
  if (value === "off") return "Off";
  if (value === "on_reduced") return "Reduced";
  if (value === "on_standard") return "On";
  return value ? value.replaceAll("_", " ") : "-";
}

function fourthDownLabel(value: string | null | undefined) {
  if (!value) return "-";
  if (value === "none") return "None";
  if (value === "standard_rec") return "Standard REC";
  if (value === "custom") return "Custom";
  return value.replaceAll("_", " ");
}

function sideLabel(value: string | null | undefined) {
  if (!value) return "-";
  return value.replaceAll("_", " ");
}

function titleCase(value: string | null | undefined) {
  if (!value) return "-";
  return value.replaceAll("_", " ");
}

function MemberStar({ tier }: { tier: EntitlementSummary["tier"] | undefined }) {
  const tone = tier === "gold" ? "gold" : "platinum";
  return (
    <span
      className={`site-league-member-star is-${tone}`}
      title="You're in this league"
      aria-label="You're in this league"
    >
      ★
    </span>
  );
}

function Pill({
  label,
  value,
  title,
}: {
  label: string;
  value: ReactNode;
  title?: string;
}) {
  return (
    <li className="site-league-pill" title={title}>
      <span className="site-league-pill-label">{label}</span>
      <span className="site-league-pill-value">{value}</span>
    </li>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="site-league-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function playCallSummary(input: {
  enabled: boolean;
  limit: number | null;
  cooldownEnabled: boolean;
  cooldown: number | null;
}) {
  if (!input.enabled && !input.cooldownEnabled) return "Off";
  const parts: string[] = [];
  if (input.enabled) parts.push(`limit ${input.limit ?? "-"}`);
  if (input.cooldownEnabled) parts.push(`cooldown ${input.cooldown ?? "-"}`);
  return parts.join(" · ") || "Off";
}

function LeagueSearchCard({
  league,
  memberTier,
  expanded,
  onToggle,
  onOpen,
  onRequestTeam,
}: {
  league: SiteLeagueSearchHit;
  memberTier: EntitlementSummary["tier"];
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onRequestTeam: () => void;
}) {
  const cfb = isCfbGame(league.game);
  const streamNeeded =
    league.regularSeasonStreamingRequirement === "required" ||
    league.regularSeasonStreamingRequirement === "recommended" ||
    league.postseasonStreamingRequirement === "required" ||
    league.postseasonStreamingRequirement === "recommended";
  const templateMeta = league.templateId ? LEAGUE_TEMPLATES.find((t) => t.id === league.templateId) ?? null : null;
  const [showAllSettings, setShowAllSettings] = useState(false);
  const leagueAbbreviation = league.name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 4).toUpperCase() || "REC";
  const isRise = league.rosterType === "rise_to_immortality";
  const poolFull = isRise && league.memberCount >= 32;

  return (
    <article className={["site-league-search-card", expanded ? "is-expanded" : ""].join(" ")}>
      <div
        className="site-league-search-card-toggle"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      >
        <div className="site-league-search-card-main">
          <div className="site-league-search-card-top">
            {league.logoUrl ? <img src={league.logoUrl} alt={`${league.name} logo`} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, flex: "0 0 auto" }} /> : <span aria-hidden="true" style={{ width: 44, height: 44, display: "grid", placeItems: "center", border: "1px solid currentColor", borderRadius: 8, fontWeight: 800, flex: "0 0 auto" }}>{leagueAbbreviation}</span>}
            <h2>
              {league.isMember ? <MemberStar tier={memberTier} /> : null}
              {league.name}
              {templateMeta ? <span className="site-league-template-badge"> ({templateMeta.name})</span> : null}
              {!league.crossPlayEnabled && league.requiredConsole && (
                <span className="site-console-badge" title={`${consoleLabel(league.requiredConsole)} only — cross play is disabled`}>
                  {consoleLabel(league.requiredConsole)}
                </span>
              )}
            </h2>
            <span className="site-league-search-expand">{expanded ? "Hide details" : "Details"}</span>
          </div>
          <p className="site-muted">
            {league.gameLabel}
            {" · Commish: "}
            {league.commissionerUsername ?? "-"}
            {` · ${league.memberCount} members`}
          </p>

          <div className="site-league-search-highlights" aria-label="Season status">
            <div>
              <span>Season</span>
              <strong>{league.seasonNumber}</strong>
            </div>
            <div>
              <span>Week / Stage</span>
              <strong>{league.seasonStageLabel}</strong>
            </div>
            <div>
              <span>{isRise ? "Registration pool" : "Open teams"}</span>
              <strong>{isRise ? league.memberCount : league.openTeamCount}</strong>
            </div>
          </div>

          <ul className="site-league-search-meta">
            <Pill label="Difficulty" value={difficultyLabel(league.difficulty, league.game)} />
            <Pill label="Coin economy" value={onOff(league.coinEconomyEnabled)} />
            <Pill label="League type" value={titleCase(league.rosterType)} />
            <li className="site-league-pill-info-wrap">
              <button
                type="button"
                className="site-league-pill-info"
                aria-expanded={showAllSettings}
                aria-label="Show all league settings"
                title="Show all league settings"
                onClick={(e) => { e.stopPropagation(); setShowAllSettings((v) => !v); }}
              >
                i
              </button>
              {showAllSettings ? (
                <div className="site-league-pill-info-panel" onClick={(e) => e.stopPropagation()}>
                  {templateMeta ? (
                    <p className="site-league-template-desc">
                      <strong>{templateMeta.name}</strong> — {templateMeta.tagline}. {templateMeta.description}
                    </p>
                  ) : null}
                  <ul className="site-league-search-meta">
                    {league.coinEconomyEnabled && !league.economyPayoutsActive ? (
                      <Pill
                        label="Economy payouts"
                        value={`Needs ${league.economyMembersShort} more linked`}
                        title={`Payouts require ${league.economyMinimumLinkedUsers} linked users. This league has ${league.economyLinkedUserCount}.`}
                      />
                    ) : null}
                    <Pill
                      label="Advance timing"
                      value={
                        league.advanceTiming === "other"
                          ? (league.advanceTimingOther?.trim() || "Other")
                          : (league.advanceTiming ?? "24hr")
                      }
                    />
                    <Pill
                      label="Reg streaming"
                      value={streamingLabel(league.regularSeasonStreamingRequirement)}
                    />
                    <Pill
                      label="Post streaming"
                      value={streamingLabel(league.postseasonStreamingRequirement)}
                    />
                    <Pill label="Custom coaches" value={yesNo(league.customCoachesRequired)} />
                    <Pill label="Custom playbooks" value={yesNo(league.customPlaybooksAllowed)} />
                    <Pill label="Sliders adjusted" value={yesNo(league.slidersAdjusted)} />
                    <Pill
                      label="Quarter length"
                      value={
                        league.quarterLengthMinutes != null ? `${league.quarterLengthMinutes} min` : "-"
                      }
                    />
                    <Pill
                      label="Accel clock"
                      value={
                        league.acceleratedClockEnabled
                          ? `On${
                              league.acceleratedClockMinimumSeconds != null
                                ? ` · ${league.acceleratedClockMinimumSeconds}s`
                                : ""
                            }`
                          : "Off"
                      }
                    />
                    <Pill label="Injuries" value={injuryLabel(league.injuryPolicy)} />
                    <Pill label="Wear & tear" value={onOff(league.wearAndTearEnabled)} />
                    <Pill
                      label="4th down (reg)"
                      value={fourthDownLabel(league.fourthDownRuleTypeRegular)}
                      title={
                        league.fourthDownRuleTypeRegular === "standard_rec" ? STANDARD_REC_4TH : undefined
                      }
                    />
                    <Pill
                      label="4th down (playoff)"
                      value={fourthDownLabel(league.fourthDownRuleTypePlayoff)}
                      title={
                        league.fourthDownRuleTypePlayoff === "standard_rec" ? STANDARD_REC_4TH : undefined
                      }
                    />

                    {!cfb ? (
                      <>
                        <Pill
                          label="Coach abilities restricted"
                          value={onOff(league.coachAbilitiesRestricted)}
                          title={league.coachAbilitiesRestrictionNotes || undefined}
                        />
                        <Pill label="Trade approval" value={titleCase(league.tradeApprovalPolicy)} />
                        <Pill
                          label="CPU trading"
                          value={titleCase(league.cpuTradingPolicy)}
                          title={league.cpuTradingRestriction || undefined}
                        />
                        <Pill label="Salary cap" value={onOff(league.salaryCapEnabled)} />
                        <Pill label="Abilities" value={onOff(league.abilitiesEnabled)} />
                      </>
                    ) : (
                      <>
                        <Pill label="Coach mode" value={onOff(league.coachModeEnabled)} />
                        <Pill label="Active rosters" value={onOff(Boolean(league.activeRostersEnabled))} />
                        <Pill
                          label="Teams replaced with customs"
                          value={yesNo(league.dynastyType === "mixed")}
                        />
                        <Pill
                          label="Conference realignment"
                          value={
                            league.conferenceRealignment === "allowed"
                              ? league.conferenceReassignments.length > 0
                                ? `Allowed · ${league.conferenceReassignments.length} reassigned`
                                : "Allowed"
                              : "Locked"
                          }
                        />
                        <Pill label="Recruiting difficulty" value={titleCase(league.recruitingDifficulty)} />
                        <Pill label="Coach XP" value={titleCase(league.coachXpSetting ?? "casual")} />
                        <Pill label="Transfer portal" value={onOff(Boolean(league.transferPortalEnabled))} />
                        <Pill
                          label="Home field advantage"
                          value={onOff(Boolean(league.homeFieldAdvantageEnabled))}
                        />
                      </>
                    )}
                  </ul>
                </div>
              ) : null}
            </li>
          </ul>
        </div>
      </div>

      {expanded ? (
        <div className="site-league-search-expanded">
          <div className="site-league-detail-grid">
            {streamNeeded ? (
              <>
                <DetailRow
                  label="Streaming side (reg)"
                  value={sideLabel(league.regularSeasonStreamingSide)}
                />
                <DetailRow
                  label="Streaming side (post)"
                  value={sideLabel(league.postseasonStreamingSide)}
                />
              </>
            ) : null}
            <DetailRow label="Coach firing" value={titleCase(league.coachFiringPolicy)} />
            <DetailRow label="Preorder bonuses" value={onOff(league.preorderBonusesEnabled)} />
            <DetailRow label="Ball hawk" value={titleCase(league.ballHawk)} />
            <DetailRow label="Heat seeker" value={titleCase(league.heatSeeker)} />
            <DetailRow label="Switch assist" value={titleCase(league.switchAssist)} />
            <DetailRow
              label="Off play-call limits"
              value={playCallSummary({
                enabled: league.offensivePlayCallLimitsEnabled,
                limit: league.offensivePlayCallLimit,
                cooldownEnabled: league.offensivePlayCallCooldownEnabled,
                cooldown: league.offensivePlayCallCooldown,
              })}
            />
            <DetailRow
              label="Def play-call limits"
              value={playCallSummary({
                enabled: league.defensivePlayCallLimitsEnabled,
                limit: league.defensivePlayCallLimit,
                cooldownEnabled: league.defensivePlayCallCooldownEnabled,
                cooldown: league.defensivePlayCallCooldown,
              })}
            />
          </div>

          {league.fairSimRequirements || league.forceWinRequirements ? (
            <div className="site-league-activity">
              <h3>Activity requirements</h3>
              {league.fairSimRequirements ? <p><strong>Fair sim:</strong> {league.fairSimRequirements}</p> : null}
              {league.forceWinRequirements ? <p><strong>Force win:</strong> {league.forceWinRequirements}</p> : null}
            </div>
          ) : null}

          {league.coinEconomyEnabled ? (
            <div className="site-league-detail-grid">
              <DetailRow label="Custom players" value={onOff(league.customPlayersEnabled)} />
              <DetailRow
                label={cfb ? "Campus Legends" : "Legends"}
                value={onOff(league.legendsEnabled)}
              />
              <DetailRow label="Dev upgrades" value={onOff(league.devUpgradesEnabled)} />
              <DetailRow label="Attribute purchases" value={onOff(league.attributePurchasesEnabled)} />
              {!cfb ? (
                <DetailRow
                  label="Contract purchases"
                  value={onOff(league.contractAdjustmentPurchasesEnabled)}
                />
              ) : null}
            </div>
          ) : null}

          {!cfb ? (
            <div className="site-league-detail-grid">
              <DetailRow label="Trade deadline" value={onOff(league.tradeDeadlineEnabled)} />
              <DetailRow label="Age resets" value={onOff(league.ageResetsEnabled)} />
              <DetailRow
                label="Contract purchases"
                value={onOff(league.contractAdjustmentPurchasesEnabled)}
              />
              <DetailRow
                label="Position change policy"
                value={
                  <span title={league.positionChangePolicyDescription || undefined}>
                    {titleCase(league.positionChangePolicy)}
                  </span>
                }
              />
            </div>
          ) : (
            <div className="site-league-detail-grid">
              <DetailRow label="Coach carousel" value={onOff(Boolean(league.coachCarouselEnabled))} />
              <DetailRow label="Stadium pulse" value={onOff(Boolean(league.stadiumPulseEnabled))} />
              {league.coachModeEnabled ? (
                <>
                  <DetailRow
                    label="Recruit flipping"
                    value={onOff(Boolean(league.coachModeRecruitFlippingEnabled))}
                  />
                  <DetailRow
                    label="Auto recruiting"
                    value={onOff(Boolean(league.coachModeAutoRecruitingEnabled))}
                  />
                  <DetailRow
                    label="Auto progress players"
                    value={onOff(Boolean(league.coachModeAutoProgressPlayersEnabled))}
                  />
                  <DetailRow
                    label="User auto progression"
                    value={onOff(Boolean(league.coachModeUserAutoProgressionEnabled))}
                  />
                  <DetailRow
                    label="CPU manage budget"
                    value={onOff(Boolean(league.coachModeCpuManageBudgetEnabled))}
                  />
                  <DetailRow
                    label="CPU manage staff"
                    value={onOff(Boolean(league.coachModeCpuManageStaffEnabled))}
                  />
                  <DetailRow
                    label="CPU manage facilities"
                    value={onOff(Boolean(league.coachModeCpuManageFacilitiesEnabled))}
                  />
                </>
              ) : null}
            </div>
          )}

          {cfb &&
          league.conferenceRealignment === "allowed" &&
          league.conferenceReassignments.length > 0 ? (
            <div className="site-league-activity">
              <h3>Conference reassignments</h3>
              <ul>
                {league.conferenceReassignments.map((row) => (
                  <li key={`${row.abbreviation}-${row.toConference}`}>
                    {row.name} ({row.abbreviation}): {row.fromConference} → {row.toConference}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="site-league-search-actions">
            <button
              type="button"
              className="site-btn site-btn-primary"
              onClick={league.isMember ? onOpen : onRequestTeam}
              disabled={!league.isMember && (isRise ? poolFull : league.openTeamCount === 0)}
              title={
                league.isMember
                  ? "Open hub"
                  : isRise
                    ? "Join the registration pool. Franchises are assigned at the rookie draft."
                    : "Join from Discord or request a team first"
              }
            >
              {league.isMember ? "Open hub" : isRise ? "Join pool" : "Request Team"}
            </button>
          </div>
        </div>
      ) : (
        <div className="site-league-search-actions site-league-search-actions-collapsed">
          <button
            type="button"
            className="site-btn site-btn-primary"
            onClick={league.isMember ? onOpen : onRequestTeam}
            disabled={!league.isMember && (isRise ? poolFull : league.openTeamCount === 0)}
            title={
              league.isMember ? "Open hub" : isRise ? "Join the registration pool" : "Join from Discord or request a team first"
            }
          >
            {league.isMember ? "Open" : isRise ? "Join pool" : "Request Team"}
          </button>
        </div>
      )}
    </article>
  );
}

export function LeaguesPage() {
  const hub = useHub();
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") === "mine" ? "mine" : "search") as Tab;

  const [memberTier, setMemberTier] = useState<EntitlementSummary["tier"]>("none");
  const [canCreateLeague, setCanCreateLeague] = useState(false);
  const [createWizardOpen, setCreateWizardOpen] = useState(false);

  useEffect(() => {
    siteApi.getLeagueCreatorStatus().then((res) => setCanCreateLeague(res.allowed)).catch(() => setCanCreateLeague(false));
  }, []);
  const [q, setQ] = useState(params.get("q") ?? "");
  // This page only ever shows Madden 27 leagues -- CFB 27 and Madden 26 aren't offered here.
  const game = "madden_27";
  const [openTeamAbbr, setOpenTeamAbbr] = useState(params.get("team") ?? "");
  const [difficulty, setDifficulty] = useState(params.get("difficulty") ?? "");
  const [streamingRequirement, setStreamingRequirement] = useState(params.get("stream") ?? "");
  const [tradeApprovalPolicy, setTradeApprovalPolicy] = useState(params.get("trade") ?? "");
  const [coinEconomy, setCoinEconomy] = useState<"" | "true" | "false">(
    (params.get("economy") as "" | "true" | "false") || "",
  );
  const [acceleratedClock, setAcceleratedClock] = useState<"" | "true" | "false">(
    (params.get("clock") as "" | "true" | "false") || "",
  );
  const [offPlayCall, setOffPlayCall] = useState<"" | "true" | "false">(
    (params.get("offLimits") as "" | "true" | "false") || "",
  );
  const [defPlayCall, setDefPlayCall] = useState<"" | "true" | "false">(
    (params.get("defLimits") as "" | "true" | "false") || "",
  );
  const [rosterType, setRosterType] = useState(params.get("roster") ?? "");
  const [templateId, setTemplateId] = useState(params.get("template") ?? "");
  const [sort, setSort] = useState(params.get("sort") ?? "name_asc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [requestLeague, setRequestLeague] = useState<SiteLeagueSearchHit | null>(null);
  const [requestTeams, setRequestTeams] = useState<SiteOpenTeam[]>([]);
  const [requestTeamId, setRequestTeamId] = useState("");
  const [requestPendingTeamId, setRequestPendingTeamId] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [requestJoinedPool, setRequestJoinedPool] = useState(false);

  const [pendingInvites, setPendingInvites] = useState<SiteLeagueInvitePending[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteAction, setInviteAction] = useState<string | null>(null);

  const [results, setResults] = useState<SiteLeagueSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const difficultyOptions = MADDEN_DIFFICULTY;
  const openTeamOptions = useMemo(() => teamOptionsForGame(), []);

  const filters = useMemo<SiteLeagueSearchFilters>(() => ({
    q: q.trim() || undefined,
    game,
    openTeamAbbr: openTeamAbbr || undefined,
    difficulty: difficulty || undefined,
    streamingRequirement: streamingRequirement || undefined,
    tradeApprovalPolicy: tradeApprovalPolicy || undefined,
    coinEconomyEnabled: boolTri(coinEconomy),
    acceleratedClockEnabled: boolTri(acceleratedClock),
    offensivePlayCallLimitsEnabled: boolTri(offPlayCall),
    defensivePlayCallLimitsEnabled: boolTri(defPlayCall),
    rosterType: rosterType || undefined,
    templateId: templateId || undefined,
    sort: (SORT_OPTIONS.some((o) => o.value === sort)
      ? sort
      : "name_asc") as SiteLeagueSearchFilters["sort"],
    limit: 60,
  }), [
    q,
    openTeamAbbr,
    difficulty,
    streamingRequirement,
    tradeApprovalPolicy,
    coinEconomy,
    acceleratedClock,
    offPlayCall,
    defPlayCall,
    rosterType,
    templateId,
    sort,
  ]);

  useEffect(() => {
    if (auth.status !== "signed-in") {
      setMemberTier("none");
      return;
    }
    let cancelled = false;
    siteApi
      .getLinkProfile()
      .then((profile) => {
        if (!cancelled) setMemberTier(profile.entitlements?.tier ?? "none");
      })
      .catch(() => {
        if (!cancelled) setMemberTier("none");
      });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  useEffect(() => {
    if (auth.status !== "signed-in") {
      setPendingInvites([]);
      return;
    }
    let cancelled = false;
    siteApi
      .listPendingInvites()
      .then((res) => {
        if (!cancelled) setPendingInvites(res.invites);
      })
      .catch(() => {
        if (!cancelled) setPendingInvites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.status, inviteAction]);

  async function respondToInvite(inviteId: string, action: "accept" | "decline") {
    setInviteBusy(true);
    setInviteError(null);
    setInviteAction(inviteId);
    try {
      await siteApi.respondLeagueInvite(inviteId, action);
      setInviteAction(null);
      if (action === "accept") {
        await hub.refreshLeagues();
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not respond to the invite.");
    } finally {
      setInviteBusy(false);
    }
  }

  useEffect(() => {
    if (tab !== "search") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpandedId(null);
    const timer = window.setTimeout(() => {
      siteApi
        .searchLeagues(filters)
        .then((res) => {
          if (cancelled) return;
          setResults(res.leagues);
        })
        .catch((err) => {
          if (cancelled) return;
          setResults([]);
          setError(err instanceof Error ? err.message : "Could not search leagues.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, filters]);

  function setTab(next: Tab) {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  }

  function openLeague(leagueId: string) {
    hub.selectLeague(leagueId);
    navigate(`/l/${leagueId}/buzz`);
  }

  async function openTeamRequest(league: SiteLeagueSearchHit) {
    setRequestLeague(league);
    setRequestTeams([]);
    setRequestTeamId("");
    setRequestError(null);
    setRequestSent(false);
    setRequestJoinedPool(false);
    setRequestPendingTeamId(null);
    if (league.rosterType === "rise_to_immortality") return;
    setRequestBusy(true);
    try {
      const result = await siteApi.listOpenLeagueTeams(league.id);
      setRequestTeams(result.teams);
      setRequestPendingTeamId(result.pendingTeamId);
      if (!result.pendingTeamId && result.teams[0]) setRequestTeamId(result.teams[0].id);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Could not load open teams.");
    } finally {
      setRequestBusy(false);
    }
  }

  async function submitPoolJoin() {
    if (!requestLeague) return;
    setRequestBusy(true);
    setRequestError(null);
    try {
      await siteApi.joinRisePool(requestLeague.id);
      setRequestJoinedPool(true);
      void hub.refreshLeagues();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Could not join the pool.");
    } finally {
      setRequestBusy(false);
    }
  }

  async function submitTeamRequest() {
    if (!requestLeague || !requestTeamId) return;
    setRequestBusy(true);
    setRequestError(null);
    try {
      await siteApi.requestLeagueTeam(requestLeague.id, requestTeamId);
      setRequestPendingTeamId(requestTeamId);
      setRequestSent(true);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Could not submit the request.");
    } finally {
      setRequestBusy(false);
    }
  }

  return (
    <div className="site-leagues-page">
      <div className="site-leagues-header">
        <div>
          <h1>Leagues</h1>
          <p>Find open leagues by settings, or jump into one you already play.</p>
        </div>
        {canCreateLeague && (
          <button type="button" className="site-btn site-btn-primary" onClick={() => setCreateWizardOpen(true)}>
            Create League
          </button>
        )}
        <div className="site-leagues-tabs" role="tablist" aria-label="League views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "search"}
            className={["site-btn", tab === "search" ? "site-btn-primary" : "site-btn-ghost"].join(" ")}
            onClick={() => setTab("search")}
          >
            League search
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "mine"}
            className={["site-btn", tab === "mine" ? "site-btn-primary" : "site-btn-ghost"].join(" ")}
            onClick={() => setTab("mine")}
          >
            My Leagues
          </button>
        </div>
      </div>

      {pendingInvites.length > 0 ? (
        <section className="site-leagues-invites">
          <h2>League invitations</h2>
          <p className="site-muted">
            You've been invited to join these leagues. Accepting adds you as a member — you can pick a team after.
          </p>
          {inviteError ? <p className="site-auth-error">{inviteError}</p> : null}
          <ul>
            {pendingInvites.map((invite) => (
              <li key={invite.inviteId} className="site-leagues-invite-row">
                <div className="site-leagues-invite-info">
                  <strong>{invite.leagueName}</strong>
                  <span className="site-muted">
                    from @{invite.inviter.username}
                    {invite.message ? ` — ${invite.message}` : ""}
                  </span>
                </div>
                <div className="site-leagues-invite-actions">
                  <button
                    type="button"
                    className="site-btn site-btn-primary site-btn-sm"
                    disabled={inviteBusy}
                    onClick={() => void respondToInvite(invite.inviteId, "accept")}
                  >
                    {inviteAction === invite.inviteId ? "Accepting…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    className="site-btn site-btn-ghost site-btn-sm"
                    disabled={inviteBusy}
                    onClick={() => void respondToInvite(invite.inviteId, "decline")}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "mine" ? (
        <section className="site-leagues-panel">
          {hub.leaguesLoading ? (
            <p className="site-muted">Loading your leagues...</p>
          ) : hub.leaguesError ? (
            <p className="site-auth-error">{hub.leaguesError}</p>
          ) : hub.leagues.length === 0 ? (
            <p className="site-muted">
              No leagues linked yet. Search for one, or finish Account linking.
            </p>
          ) : (
            <div className="site-league-list">
              {hub.leagues.map((league) => (
                <div key={league.id} className="site-league-card-wrap">
                  <button
                    type="button"
                    className="site-league-card"
                    onClick={() => openLeague(league.id)}
                  >
                    <strong>
                      <MemberStar tier={memberTier} /> {league.name}
                    </strong>
                    <span>
                      {league.gameLabel}
                      {league.teamName ? ` · ${league.teamName}` : ""}
                      {` · ${roleLabel(league)}`}
                    </span>
                  </button>
                  {league.commissionerRole === "head" && !league.discordBotEnabled && (
                    <ConnectDiscordCard league={league} />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="site-leagues-panel">
          <div className="site-leagues-search-row">
            <label className="site-field site-leagues-search-field">
              <span>Search</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="League name, keyword, commissioner username or Discord"
              />
            </label>
            <label className="site-field">
              <span>Sort</span>
              <select className="site-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="site-btn site-btn-ghost site-leagues-filter-toggle"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {filtersOpen ? "Hide filters" : "Filters"}
            </button>
          </div>

          {filtersOpen ? (
            <div className="site-leagues-filters">
              <label className="site-field">
                <span>Open team</span>
                <select
                  className="site-select"
                  value={openTeamAbbr}
                  onChange={(e) => setOpenTeamAbbr(e.target.value)}
                >
                  <option value="">Any open team</option>
                  {openTeamOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="site-field">
                <span>Difficulty</span>
                <select
                  className="site-select"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                >
                  {difficultyOptions.map((opt) => (
                    <option key={opt.value || "any-diff"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="site-field">
                <span>Streaming</span>
                <select
                  className="site-select"
                  value={streamingRequirement}
                  onChange={(e) => setStreamingRequirement(e.target.value)}
                >
                  {STREAM_OPTIONS.map((opt) => (
                    <option key={opt.value || "any-stream"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="site-field">
                <span>Roster type</span>
                <select
                  className="site-select"
                  value={rosterType}
                  onChange={(e) => setRosterType(e.target.value)}
                >
                  {ROSTER_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value || "any-roster"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="site-field">
                <span>Template</span>
                <select
                  className="site-select"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">Any template</option>
                  {MADDEN_LEAGUE_TEMPLATES.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="site-field">
                <span>Trade rules</span>
                <select
                  className="site-select"
                  value={tradeApprovalPolicy}
                  onChange={(e) => setTradeApprovalPolicy(e.target.value)}
                >
                  {TRADE_OPTIONS.map((opt) => (
                    <option key={opt.value || "any-trade"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="site-field">
                <span>Coin economy</span>
                <select
                  className="site-select"
                  value={coinEconomy}
                  onChange={(e) => setCoinEconomy(e.target.value as "" | "true" | "false")}
                >
                  <option value="">Any</option>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </label>
              <label className="site-field">
                <span>Accelerated clock</span>
                <select
                  className="site-select"
                  value={acceleratedClock}
                  onChange={(e) => setAcceleratedClock(e.target.value as "" | "true" | "false")}
                >
                  <option value="">Any</option>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </label>
              <label className="site-field">
                <span>Offensive play-call limits</span>
                <select
                  className="site-select"
                  value={offPlayCall}
                  onChange={(e) => setOffPlayCall(e.target.value as "" | "true" | "false")}
                >
                  <option value="">Any</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
              <label className="site-field">
                <span>Defensive play-call limits</span>
                <select
                  className="site-select"
                  value={defPlayCall}
                  onChange={(e) => setDefPlayCall(e.target.value as "" | "true" | "false")}
                >
                  <option value="">Any</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
            </div>
          ) : null}

          {error ? <p className="site-auth-error">{error}</p> : null}
          {loading ? <p className="site-muted">Searching leagues...</p> : null}
          {!loading && !error && results.length === 0 ? (
            <p className="site-muted">No leagues match those filters.</p>
          ) : null}

          <div className="site-league-search-list">
            {results.map((league) => (
              <LeagueSearchCard
                key={league.id}
                league={league}
                memberTier={memberTier}
                expanded={expandedId === league.id}
                onToggle={() =>
                  setExpandedId((id) => (id === league.id ? null : league.id))
                }
                onOpen={() => openLeague(league.id)}
                onRequestTeam={() => void openTeamRequest(league)}
              />
            ))}
          </div>
        </section>
      )}
      {requestLeague ? (
        <div className="site-modal-backdrop" role="presentation" onMouseDown={() => setRequestLeague(null)}>
          <section className="site-modal site-team-request-modal" role="dialog" aria-modal="true" aria-labelledby="team-request-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="site-modal-close" onClick={() => setRequestLeague(null)} aria-label="Close">×</button>
            <h2 id="team-request-title">{requestLeague.rosterType === "rise_to_immortality" ? `Join ${requestLeague.name}` : `Request a team in ${requestLeague.name}`}</h2>
            {requestLeague.rosterType === "rise_to_immortality" ? (
              <>
                <p className="site-muted">
                  You join a registration pool — no team yet. After the virtual rookie draft you are linked to a franchise on the site and Discord automatically.
                </p>
                {requestJoinedPool ? (
                  <p className="site-success">You are in the pool. Open the league to complete Origins.</p>
                ) : (
                  <button type="button" className="site-btn site-btn-primary" disabled={requestBusy} onClick={() => void submitPoolJoin()}>
                    {requestBusy ? "Joining…" : "Join the pool"}
                  </button>
                )}
                {requestJoinedPool ? (
                  <button type="button" className="site-btn site-btn-ghost" onClick={() => { const id = requestLeague.id; setRequestLeague(null); openLeague(id); }}>
                    Open league
                  </button>
                ) : null}
              </>
            ) : (
              <>
            <p className="site-muted">Choose one available team. The league commissioner will review your request.</p>
            {!requestLeague.crossPlayEnabled && requestLeague.requiredConsole && (
              <p className="site-muted"><strong>This league is for {consoleLabel(requestLeague.requiredConsole)} only.</strong></p>
            )}
            {requestBusy && requestTeams.length === 0 ? <p>Loading available teams…</p> : null}
            {requestPendingTeamId ? (
              <p className="site-success">Your team request is pending commissioner approval.</p>
            ) : requestTeams.length ? (
              <>
                <label className="site-field">
                  <span>Available team</span>
                  <select className="site-select" value={requestTeamId} onChange={(event) => setRequestTeamId(event.target.value)}>
                    {requestTeams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}{team.mascot && !team.name.includes(team.mascot) ? ` ${team.mascot}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="site-btn site-btn-primary" disabled={requestBusy || !requestTeamId} onClick={() => void submitTeamRequest()}>
                  {requestBusy ? "Submitting…" : "Submit request"}
                </button>
              </>
            ) : !requestBusy ? <p>No teams are currently available.</p> : null}
            {requestSent ? <p className="site-success">Request submitted.</p> : null}
              </>
            )}
            {requestError ? <p className="site-auth-error">{requestError}</p> : null}
          </section>
        </div>
      ) : null}
      {createWizardOpen && (
        <CreateLeagueWizard
          onClose={() => setCreateWizardOpen(false)}
          onCreated={() => {
            setCreateWizardOpen(false);
            setParams((current) => { const next = new URLSearchParams(current); next.set("tab", "mine"); return next; });
            void hub.refreshLeagues();
          }}
        />
      )}
    </div>
  );
}
