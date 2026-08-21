import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { StatusChip } from "../design-system/StatusChip.js";

type Snapshot = Awaited<ReturnType<typeof recApi.getSchedulingMatchupStatus>>;

const LABELS: Record<string, string> = {
  not_scheduled: "Not Scheduled",
  waiting_on_opponent: "Waiting on Opponent",
  reschedule_requested: "Reschedule Requested",
  no_shared_availability: "No Shared Availability",
  needs_commissioner_help: "Needs Commissioner Help",
  live: "Live",
  completed: "Completed",
};

function countdown(iso: string, now: number) {
  const delta = new Date(iso).getTime() - now;
  if (delta <= 0) return "kickoff time reached";
  const totalMinutes = Math.ceil(delta / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  return [days ? `${days}d` : null, hours ? `${hours}h` : null, `${minutes}m`].filter(Boolean).join(" ");
}

export function HeroSchedulingStatus({ guildId, gameId, reloadKey }: { guildId: string; gameId: string; reloadKey: number }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      recApi.getSchedulingMatchupStatus({ guildId, gameId }),
      recApi.getSchedulingAvailabilityProfile(guildId).catch(() => null),
    ]).then(([status, profile]) => {
      if (cancelled) return;
      setSnapshot(status);
      setTimeZone(profile?.profile.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null);
    }).catch(() => { if (!cancelled) setSnapshot(null); });
    return () => { cancelled = true; };
  }, [guildId, gameId, reloadKey]);

  useEffect(() => {
    if (!snapshot?.scheduledFor || snapshot.status !== "confirmed") return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [snapshot?.scheduledFor, snapshot?.status]);

  const label = useMemo(() => {
    if (!snapshot) return null;
    if (snapshot.forceWinState === "approved") return "Force Win Approved";
    if (snapshot.forceWinState === "requested" || snapshot.fwFlagged) return "Force Win Requested";
    const instant = snapshot.status === "confirmed" ? snapshot.scheduledFor : snapshot.pendingProposal?.proposedFor ?? null;
    if (!instant) return LABELS[snapshot.status] ?? snapshot.status.replace(/_/g, " ");
    const formatted = new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone ?? undefined,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(instant));
    if (snapshot.status === "confirmed") return `Agreed · ${formatted} · ${countdown(instant, now)}`;
    return `${snapshot.pendingProposal?.proposedByMe ? "Your proposal" : "Proposed time"} · ${formatted}`;
  }, [now, snapshot, timeZone]);

  if (!snapshot || !label) return null;
  return <StatusChip className="hub-hero-scheduling-status" status={snapshot.forceWinState === "approved" ? "approved" : snapshot.status === "confirmed" ? "approved" : snapshot.status === "not_scheduled" || snapshot.forceWinState === "requested" ? "pending" : "info"} label={label} />;
}
