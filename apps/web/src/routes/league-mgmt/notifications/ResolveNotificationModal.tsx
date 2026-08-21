import { useEffect, useState } from "react";
import { CASE_STATUS_BADGE, sortRecAttributeKeys } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { ChatTopic, CommissionerCaseEvent, CommissionerNotification, HighlightReviewDetail } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { Badge } from "../../../components/ui/Badge.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { useHubChrome } from "../../../lib/hub-chrome-context.js";

type ReplaceTarget = { playerId?: string; position: string; firstName: string; lastName: string };
type ReplacementCandidate = {
  id: string;
  full_name: string | null;
  first_name: string;
  last_name: string;
  position: string;
  overall_rating: number | null;
};

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCandidate(player: ReplacementCandidate) {
  const name = player.full_name || `${player.first_name} ${player.last_name}`.trim();
  const ovr = player.overall_rating != null ? `${player.overall_rating} OVR` : "— OVR";
  return `${player.position} ${name} · ${ovr}`;
}

// Madden legend review: when the buyer left the outgoing player to the commissioner, show
// their roster sorted worst-OVR-first and require a pick before Approve & Apply. That pick
// (or the buyer's own designation) is permanently deleted when the legend is installed.
function MaddenReplacementPicker({
  purchaseId,
  guildId,
  leagueId,
  buyerReplaceTarget,
  selectedPlayerId,
  setSelectedPlayerId,
}: {
  purchaseId: string;
  guildId: string;
  leagueId?: string;
  buyerReplaceTarget: ReplaceTarget | null;
  selectedPlayerId: string;
  setSelectedPlayerId: (value: string) => void;
}) {
  const [candidates, setCandidates] = useState<ReplacementCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const buyerChose = Boolean(buyerReplaceTarget?.playerId);

  useEffect(() => {
    let cancelled = false;
    recApi.listLegendReplacementCandidates({ guildId, leagueId, purchaseId })
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.replacementPlayers);
        if (result.buyerReplaceTarget?.playerId) {
          setSelectedPlayerId(result.buyerReplaceTarget.playerId);
        } else if (!selectedPlayerId && result.replacementPlayers[0]) {
          setSelectedPlayerId(result.replacementPlayers[0].id);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load roster players.");
      });
    return () => { cancelled = true; };
  }, [guildId, leagueId, purchaseId]);

  return (
    <div className="form-field">
      {buyerChose ? (
        <p className="form-hint" style={{ marginTop: 0 }}>
          Buyer designated replacement: {buyerReplaceTarget!.position} {buyerReplaceTarget!.firstName} {buyerReplaceTarget!.lastName}.
          That player will be permanently removed from their roster when you approve &amp; apply.
        </p>
      ) : (
        <p className="form-hint" style={{ marginTop: 0 }}>
          Buyer left the replaced player up to you. Optional — recreate this legend on any roster slot in
          Madden and the next import will match it by name regardless of what's picked here.
        </p>
      )}
      {loadError && <p className="form-hint">{loadError}</p>}
      {!buyerChose && (
        <label className="form-field">
          <span className="form-label">Replace roster player</span>
          <select
            className="form-input"
            value={selectedPlayerId}
            onChange={(event) => setSelectedPlayerId(event.target.value)}
            disabled={!candidates?.length}
          >
            <option value="">{candidates?.length ? "Select a player" : "Loading roster…"}</option>
            {(candidates ?? []).map((player) => (
              <option key={player.id} value={player.id}>{formatCandidate(player)}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

// Legend purchase detail: replaces the wall-of-text summary with a real key/value grid plus
// a sorted attribute table, so a commissioner can actually scan it instead of reading a
// run-on paragraph or a plain list of newline-separated lines.
function LegendPurchaseDetail({ payload }: { payload: Record<string, unknown> }) {
  const isCfb = payload.isCfb === true;
  const attributeMap = (payload.attributes as Record<string, number>) ?? {};
  const attributes = sortRecAttributeKeys(Object.keys(attributeMap)).map((key) => [key, attributeMap[key]!] as const);
  const replaceTarget = payload.replaceTarget as { playerId?: string; position: string; firstName: string; lastName: string } | null | undefined;
  const facts: Array<[string, string]> = [
    ["Team", String(payload.teamName ?? "Unassigned")],
    ["Position", String(payload.legendPosition ?? "—")],
    ["Height", String(payload.height ?? "—")],
    ["Weight", payload.weight != null ? `${payload.weight} lb` : "—"],
    ["Est. OVR", String(payload.estOvr ?? "—")],
    ...(!isCfb ? [["Dev Trait", String(payload.devTrait ?? "—")] as [string, string]] : []),
    ...(payload.bodyType ? [["Body Type", String(payload.bodyType)] as [string, string]] : []),
    ["Replaces", replaceTarget?.playerId
      ? `${replaceTarget.position} ${replaceTarget.firstName} ${replaceTarget.lastName}`
      : isCfb ? "Required replacement missing" : "Commissioner's choice"],
  ];
  return (
    <div className="legend-purchase-detail">
      <p className="form-hint" style={{ marginTop: 0 }}>
        <strong>Do not approve until this player has actually been created in-game.</strong> Record any commissioner edits so the purchaser receives an accurate final build summary.
      </p>
      <dl className="legend-purchase-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {attributes.length > 0 && (
        <>
          <h4 style={{ marginBottom: "var(--space-2)" }}>Attributes</h4>
          <div className="legend-purchase-attributes">
            {attributes.map(([key, value]) => (
              <div key={key} className="legend-purchase-attribute">
                <span>{key}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Lets the commissioner actually watch the clip and see the claimed week/matchup before
// approving payout — catches a highlight uploaded from the wrong game (or an outright fake
// upload just to grab the free coins) that a bare title/subtitle can't reveal.
function HighlightReviewPreview({ guildId, reviewId }: { guildId: string; reviewId: string }) {
  const [detail, setDetail] = useState<HighlightReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recApi.getHighlightReviewDetail(guildId, reviewId)
      .then((result) => { if (!cancelled) setDetail(result); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the highlight preview."); });
    return () => { cancelled = true; };
  }, [guildId, reviewId]);

  if (error) return <p className="form-hint">{error}</p>;
  if (!detail) return <p className="form-hint">Loading highlight preview…</p>;

  return (
    <div className="highlight-review-preview">
      {detail.matchup ? (
        <p style={{ fontWeight: 600 }}>
          Week {detail.matchup.weekNumber ?? "?"} — {detail.matchup.awayTeamName ?? "?"} @ {detail.matchup.homeTeamName ?? "?"}
        </p>
      ) : (
        <p className="form-hint">No matchup on record for this highlight (Week {detail.weekNumber ?? "?"}).</p>
      )}
      {detail.submittedByName && <p className="form-hint" style={{ marginTop: 0 }}>Submitted by {detail.submittedByName}</p>}
      <div className="highlight-review-player">
        {detail.streamUid ? (
          <iframe
            src={`https://iframe.videodelivery.net/${detail.streamUid}`}
            title="Highlight preview"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : detail.videoUrl ? (
          <video src={detail.videoUrl} controls preload="metadata" />
        ) : detail.messageUrl ? (
          <a href={detail.messageUrl} target="_blank" rel="noreferrer">Open highlight</a>
        ) : (
          <p className="form-hint">No playable media for this highlight.</p>
        )}
      </div>
    </div>
  );
}

// The stream-payout card only ever said "Stream submitted by @coach" — no way to tell which
// game it was for before approving. Mirrors HighlightReviewPreview's shape/pattern above.
function StreamReviewPreview({ guildId, reviewId }: { guildId: string; reviewId: string }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof recApi.getStreamReviewDetail>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recApi.getStreamReviewDetail(guildId, reviewId)
      .then((result) => { if (!cancelled) setDetail(result); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the stream details."); });
    return () => { cancelled = true; };
  }, [guildId, reviewId]);

  if (error) return <p className="form-hint">{error}</p>;
  if (!detail) return <p className="form-hint">Loading stream details…</p>;

  return (
    <div style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-2)" }}>
      {detail.matchup ? (
        <p style={{ fontWeight: 600, margin: 0 }}>
          Week {detail.matchup.weekNumber ?? "?"} — {detail.matchup.awayTeamName} at {detail.matchup.homeTeamName} ({detail.matchup.matchupLabel})
        </p>
      ) : (
        <p className="form-hint">No matchup on record for this stream (Week {detail.weekNumber ?? "?"}).</p>
      )}
      {detail.submittedByName && <p className="form-hint" style={{ margin: "2px 0 0" }}>Submitted by {detail.submittedByName}</p>}
      {detail.messageUrl && <p style={{ margin: "2px 0 0" }}><a href={detail.messageUrl} target="_blank" rel="noreferrer">Open stream link</a></p>}
    </div>
  );
}

type WagerResolvability = Awaited<ReturnType<typeof recApi.getWagerResolvability>>;

const WAGER_OUTCOME_LABEL: Record<string, string> = { won: "Bettor won", lost: "Bettor lost", push: "Push (refund)" };

// The commissioner-inbox card only ever showed the stake and who placed the wager, with no
// way to check the computed outcome against the actual game before clicking Settle. This
// shows what was bet, on which side, the final score, and what the system has already
// computed as the outcome — so a bad settle can be caught before it pays out.
function WagerReviewPreview({ guildId, wagerId }: { guildId: string; wagerId: string }) {
  const [detail, setDetail] = useState<WagerResolvability | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recApi.getWagerResolvability({ guildId, wagerId })
      .then((result) => { if (!cancelled) setDetail(result); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the wager details."); });
    return () => { cancelled = true; };
  }, [guildId, wagerId]);

  if (error) return <p className="form-hint">{error}</p>;
  if (!detail) return <p className="form-hint">Loading wager details…</p>;

  return (
    <div style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-2)" }}>
      <p style={{ fontWeight: 600, margin: 0 }}>{detail.gameLabel ?? "House line"}</p>
      <p className="form-hint" style={{ margin: "2px 0 0" }}>
        {detail.marketLabel ?? "Market"}: took <strong>{detail.pickLabel ?? "—"}</strong>
        {detail.placedByName ? ` — ${detail.placedByName}` : ""}
        {detail.acceptedByName ? ` vs. ${detail.acceptedByName}` : ""}
      </p>
      {detail.wager && (
        <p className="form-hint" style={{ margin: "2px 0 0" }}>
          Stake {formatCoins(detail.wager.stake)} · potential payout {formatCoins(detail.wager.potential_payout)}
        </p>
      )}
      {detail.finalScore && (
        <p className="form-hint" style={{ margin: "2px 0 0" }}>
          Final: {detail.finalScore.away} {detail.finalScore.awayScore} — {detail.finalScore.home} {detail.finalScore.homeScore}
          {detail.finalScore.isTie ? " (tie)" : ""}
        </p>
      )}
      <p style={{ margin: "var(--space-2) 0 0", fontWeight: 700 }}>
        {detail.resolvable
          ? (WAGER_OUTCOME_LABEL[detail.outcome ?? ""] ?? "Outcome unknown")
          : "Not resolvable yet — the game result needed to settle this isn't logged."}
      </p>
    </div>
  );
}

function formatCoins(amount: number): string {
  return `🪙 ${Number(amount ?? 0).toLocaleString()}`;
}

// One shared resolve panel for the notification types that don't get their own dedicated
// modal. Box Scores reuse ReviewBoxScoreModal, Active Checks reuse ActiveCheckReviewModal,
// and EOS Awards reuse EosAwardResolveModal (all opened directly from NotificationsHome
// instead of through here). Every type this modal actually handles reduces to one of three
// shapes: approve/deny (with or without a reason field, depending on whether the underlying
// table has one to store it in), or a single one-click resolve action. The active_check/
// eos_award cases below are only a defensive fallback for the rare case a notification of
// that type is missing its sourceId.
type ResolveMode =
  | { kind: "approve_deny"; reasonField: boolean; approveLabel: string; denyLabel: string }
  | { kind: "single"; actionLabel: string }
  | { kind: "info"; message: string };

function resolveModeFor(type: string): ResolveMode {
  switch (type) {
    case "purchase":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Approve", denyLabel: "Deny" };
    case "legend":
      // Madden defers the actual roster write to the next EA import; CFB applies immediately.
      // The notification's own summary text (legends.service.ts) explains which applies here.
      return { kind: "approve_deny", reasonField: true, approveLabel: "Approve", denyLabel: "Deny" };
    case "highlight":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Approve", denyLabel: "Deny" };
    case "game_of_the_year":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Crown Winner", denyLabel: "Deny" };
    case "stream":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Approve", denyLabel: "Deny" };
    case "media":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Approve & Publish", denyLabel: "Deny" };
    case "team_request":
      return { kind: "approve_deny", reasonField: false, approveLabel: "Approve", denyLabel: "Reject" };
    case "weekly_score_review":
      return { kind: "approve_deny", reasonField: false, approveLabel: "Log Scores", denyLabel: "Cancel" };
    case "wager":
      return { kind: "approve_deny", reasonField: false, approveLabel: "Settle Wager", denyLabel: "Reject Wager" };
    case "trade":
      return { kind: "approve_deny", reasonField: false, approveLabel: "Approve Trade", denyLabel: "Reject Trade" };
    case "active_check":
      return { kind: "info", message: "This active check is missing its event reference — resolve it from Discord instead." };
    case "eos_award":
      return { kind: "info", message: "This award poll is missing its poll reference — resolve it from Discord instead." };
    case "force_win_request":
      return { kind: "approve_deny", reasonField: true, approveLabel: "Approve Force Win", denyLabel: "Deny" };
    case "autopilot_request":
    case "matchup_issue_report":
    case "ea_auto_import":
      return { kind: "single", actionLabel: "Mark Handled" };
    default:
      return { kind: "info", message: "This notification type doesn't have a web resolve action yet." };
  }
}

async function resolveAction(
  guildId: string,
  leagueId: string | undefined,
  notification: CommissionerNotification,
  action: "approve" | "deny",
  reason: string,
  finalReplaceTarget?: { playerId: string } | null,
) {
  const sourceId = notification.sourceId ?? "";
  switch (notification.type) {
    case "purchase":
      return recApi.reviewPurchase({ guildId, leagueId, purchaseId: sourceId, action, deniedReason: reason || undefined });
    case "legend":
      return recApi.reviewPurchase({
        guildId,
        leagueId,
        purchaseId: sourceId,
        action,
        deniedReason: reason || undefined,
        finalReplaceTarget: action === "approve" ? finalReplaceTarget : undefined,
      });
    case "highlight":
      return recApi.reviewHighlight({ guildId, leagueId, reviewId: sourceId, action, deniedReason: reason || undefined });
    case "game_of_the_year":
      return recApi.reviewGameOfYear({ guildId, leagueId, reviewId: sourceId, action, deniedReason: reason || undefined });
    case "stream":
      return recApi.reviewStream({ guildId, leagueId, reviewId: sourceId, action, deniedReason: reason || undefined });
    case "media":
      return recApi.reviewMedia({ guildId, reviewId: sourceId, action, deniedReason: reason || undefined });
    case "team_request":
      return action === "approve"
        ? recApi.approveTeamRequest({ guildId, leagueId, requestId: sourceId })
        : recApi.rejectTeamRequest({ guildId, leagueId, requestId: sourceId });
    case "weekly_score_review":
      return action === "approve"
        ? recApi.approveWeeklyScoreReview({ guildId, reviewId: sourceId })
        : recApi.cancelWeeklyScoreReview({ guildId, reviewId: sourceId });
    case "wager":
      return action === "approve"
        ? recApi.settleWager({ guildId, leagueId, wagerId: sourceId })
        : recApi.commissionerCancelWager({ guildId, wagerId: sourceId });
    case "trade":
      return recApi.reviewTrade({ guildId, tradeId: sourceId, action: action === "approve" ? "approve" : "reject" });
    case "force_win_request":
      return recApi.reviewForceWinRequest({ guildId, inboxId: notification.id, decision: action, reason: reason || undefined });
    case "autopilot_request":
    case "matchup_issue_report":
    case "ea_auto_import":
      // No dedicated review table for these — the generic handler resolves by the inbox row's
      // own id (notification.id), not sourceId (which is the matchup's gameId, not unique
      // per request — a game can have more than one pending help request at once).
      return recApi.markCommissionerInboxItemHandled({ guildId, inboxId: notification.id });
    default:
      throw new Error("No resolve action for this notification type.");
  }
}

export function ResolveNotificationModal({
  notification,
  onClose,
  onResolved,
}: {
  notification: CommissionerNotification;
  onClose: () => void;
  onResolved: () => void;
}) {
  const { guildId } = useReadyAuth();
  const { currentLeague } = useHubChrome();
  const leagueId = currentLeague?.id;
  const mode = resolveModeFor(notification.type);
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyerReplaceTarget = (notification.payload?.replaceTarget as ReplaceTarget | null | undefined) ?? null;
  const [selectedReplacementPlayerId, setSelectedReplacementPlayerId] = useState(buyerReplaceTarget?.playerId ?? "");

  // Commissioner Command Center: internal memo, audit timeline, and case voting — additive,
  // shown for every notification type since the underlying columns exist on every case.
  const [memo, setMemo] = useState(notification.internalMemo ?? "");
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoSaved, setMemoSaved] = useState(false);
  const [events, setEvents] = useState<CommissionerCaseEvent[] | null>(null);
  const [votingTopicId, setVotingTopicId] = useState(notification.votingTopicId);
  const [votingTopic, setVotingTopic] = useState<ChatTopic | null>(null);
  const [startingVote, setStartingVote] = useState(false);
  const [awaitingUser, setAwaitingUser] = useState(notification.awaitingUserResponse);
  const [awaitingUserSaving, setAwaitingUserSaving] = useState(false);

  useEffect(() => {
    recApi.listCaseEvents({ guildId, inboxId: notification.id }).then((res) => setEvents(res.events)).catch(() => setEvents([]));
  }, [guildId, notification.id]);

  useEffect(() => {
    if (!votingTopicId) {
      setVotingTopic(null);
      return;
    }
    recApi.listChatTopics(guildId).then((res) => setVotingTopic(res.topics.find((t) => t.id === votingTopicId) ?? null)).catch(() => setVotingTopic(null));
  }, [guildId, votingTopicId]);

  async function saveMemo() {
    setMemoSaving(true);
    setMemoSaved(false);
    try {
      await recApi.addCaseMemo({ guildId, inboxId: notification.id, memo });
      setMemoSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save memo.");
    } finally {
      setMemoSaving(false);
    }
  }

  async function toggleAwaitingUser(next: boolean) {
    setAwaitingUserSaving(true);
    setError(null);
    try {
      await recApi.setCaseAwaitingUserResponse({ guildId, inboxId: notification.id, awaiting: next });
      setAwaitingUser(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update case status.");
    } finally {
      setAwaitingUserSaving(false);
    }
  }

  async function startVote() {
    setStartingVote(true);
    setError(null);
    try {
      const created = await recApi.createChatTopic({
        guildId,
        title: notification.title,
        description: notification.subtitle,
        options: ["Approve", "Deny"],
      });
      await recApi.linkCaseToVotingTopic({ guildId, inboxId: notification.id, topicId: created.topic.id });
      setVotingTopicId(created.topic.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start a vote.");
    } finally {
      setStartingVote(false);
    }
  }

  async function handle(action: "approve" | "deny") {
    setBusy(true);
    setError(null);
    try {
      // Madden's replacement pick is now purely informational (the real roster swap
      // happens by name match at the next EA import), so it's optional — only send it
      // along if the commissioner actually picked something. CFB still applies the swap
      // immediately, so a CFB legend always carries the buyer's designation.
      const selectedTarget = selectedReplacementPlayerId || buyerReplaceTarget?.playerId || "";
      const finalReplaceTarget =
        action === "approve" && notification.type === "legend" && notification.payload?.isCfb !== true && selectedTarget
          ? { playerId: selectedTarget }
          : undefined;
      const result = await resolveAction(guildId, leagueId, notification, action, reason, finalReplaceTarget);
      // Wager settle/reject can come back { ok: false, ... } instead of throwing (e.g. the
      // wager already left pending/confirmed some other way, like an auto-refund) — without
      // this check the modal just closed as if it worked, so clicking Settle looked like it
      // silently did nothing.
      if (result && typeof result === "object" && "ok" in result && result.ok === false) {
        const r = result as { alreadyResolved?: boolean; status?: string };
        setError(
          r.alreadyResolved
            ? `This wager is already ${r.status ?? "resolved"} — nothing to settle. The card has been cleared.`
            : "This wager can't be settled yet — the game result it depends on isn't confirmed.",
        );
        setBusy(false);
        onResolved();
        return;
      }
      onResolved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve this notification.");
      setBusy(false);
    }
  }

  return (
    <Modal title={notification.title} onClose={onClose}>
      {error && <ErrorState message={error} />}
      <Badge status={CASE_STATUS_BADGE[notification.displayStatus]}>{notification.displayStatus}</Badge>
      {notification.type === "legend" && notification.payload ? (
        <LegendPurchaseDetail payload={notification.payload} />
      ) : (
        <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-2)", whiteSpace: "pre-line" }}>{notification.subtitle}</p>
      )}
      {notification.type === "highlight" && notification.sourceId && (
        <HighlightReviewPreview guildId={guildId} reviewId={notification.sourceId} />
      )}
      {notification.type === "wager" && notification.sourceId && (
        <WagerReviewPreview guildId={guildId} wagerId={notification.sourceId} />
      )}
      {notification.type === "stream" && notification.sourceId && (
        <StreamReviewPreview guildId={guildId} reviewId={notification.sourceId} />
      )}
      {notification.type === "media" && notification.payload && (
        <div className="media-review-preview">
          <h3>{String(notification.payload.title ?? notification.title)}</h3>
          {typeof notification.payload.imageUrl === "string" && notification.payload.imageUrl && <img src={notification.payload.imageUrl} alt="" />}
          {Array.isArray(notification.payload.answers) ? (
            <div>{(notification.payload.answers as any[]).map((answer, index) => <article key={index}><strong>{answer.question}</strong><p>{answer.answer}</p></article>)}</div>
          ) : (
            <p>{String(notification.payload.body ?? "")}</p>
          )}
        </div>
      )}
      {notification.amount != null && (
        <p style={{ fontWeight: 700, fontSize: "var(--text-lg)" }}>${notification.amount}</p>
      )}

      {notification.type === "legend" && notification.payload?.isCfb !== true && notification.sourceId && (
        <MaddenReplacementPicker
          purchaseId={notification.sourceId}
          guildId={guildId}
          leagueId={leagueId}
          buyerReplaceTarget={buyerReplaceTarget}
          selectedPlayerId={selectedReplacementPlayerId}
          setSelectedPlayerId={setSelectedReplacementPlayerId}
        />
      )}

      {mode.kind === "info" && <p className="form-hint">{mode.message}</p>}

      {mode.kind === "single" && (
        <Button variant="primary" onClick={() => handle("approve")} disabled={busy}>
          {busy ? "Working…" : mode.actionLabel}
        </Button>
      )}

      {mode.kind === "approve_deny" && (
        <div>
          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            <Button variant="primary" onClick={() => handle("approve")} disabled={busy}>
              {mode.approveLabel}
            </Button>
            <Button variant="danger" onClick={() => (mode.reasonField ? setShowDenyInput(true) : handle("deny"))} disabled={busy}>
              {mode.denyLabel}
            </Button>
          </div>
          {mode.reasonField && showDenyInput && (
            <div className="form-field">
              <label className="form-label" htmlFor="resolve-reason">Reason</label>
              <input
                id="resolve-reason"
                className="form-input"
                placeholder={`Reason for ${mode.denyLabel.toLowerCase()}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div style={{ marginTop: "var(--space-3)" }}>
                <Button variant="danger" onClick={() => handle("deny")} disabled={busy || !reason.trim()}>
                  Confirm {mode.denyLabel}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)" }}>
        <label className="form-field">
          <span className="form-label">Internal Memo (commissioner-only)</span>
          <textarea
            className="form-input"
            rows={3}
            maxLength={2000}
            value={memo}
            onChange={(e) => { setMemo(e.target.value); setMemoSaved(false); }}
            placeholder="Notes for other commissioners — not visible to the requester."
          />
        </label>
        <Button variant="secondary" size="compact" onClick={() => void saveMemo()} disabled={memoSaving}>
          {memoSaving ? "Saving…" : memoSaved ? "Saved" : "Save Memo"}
        </Button>
      </div>

      <div style={{ marginTop: "var(--space-4)" }}>
        <strong style={{ fontSize: "var(--text-sm)" }}>Case Voting</strong>
        {votingTopic ? (
          <div style={{ marginTop: "var(--space-2)" }}>
            {votingTopic.options.map((opt, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)" }}>
                <span>{opt}</span>
                <span>{votingTopic.tally[i] ?? 0} vote{(votingTopic.tally[i] ?? 0) === 1 ? "" : "s"}</span>
              </div>
            ))}
            <span className="hub-muted" style={{ fontSize: "var(--text-xs)" }}>Status: {votingTopic.status}</span>
          </div>
        ) : (
          <div style={{ marginTop: "var(--space-2)" }}>
            <Button variant="secondary" size="compact" onClick={() => void startVote()} disabled={startingVote}>
              {startingVote ? "Starting…" : "Start a Vote"}
            </Button>
          </div>
        )}
      </div>

      <div style={{ marginTop: "var(--space-4)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
          <input
            type="checkbox"
            checked={awaitingUser}
            disabled={awaitingUserSaving}
            onChange={(e) => void toggleAwaitingUser(e.target.checked)}
          />
          Waiting on the requesting coach to respond
        </label>
      </div>

      {events && events.length > 0 && (
        <details style={{ marginTop: "var(--space-4)" }}>
          <summary style={{ cursor: "pointer", fontSize: "var(--text-sm)", fontWeight: 700 }}>Case Timeline ({events.length})</summary>
          <ul style={{ margin: "var(--space-2) 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            {events.map((event) => (
              <li key={event.id} style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                {humanize(event.eventType)} — {new Date(event.createdAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Modal>
  );
}
