import { useEffect, useState } from "react";
import { REC_ROUTE_CHANNELS } from "@rec/shared";
import { Plus } from "lucide-react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type Channel = { id: string; name: string; type: "text" | "category" };
const ALL_ROUTES = Object.entries(REC_ROUTE_CHANNELS);

export function ChannelSettings() {
  const { guildId } = useReadyAuth();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isCfb, setIsCfb] = useState(false);
  const [isRise, setIsRise] = useState(false);

  const CONFIGURABLE_ROUTES = ALL_ROUTES.filter(([, route]) =>
    !("madden_only" in route && route.madden_only && isCfb) &&
    !("rti_only" in route && route.rti_only && !isRise) &&
    !("hidden_for_rti" in route && route.hidden_for_rti && isRise));

  const load = () => Promise.all([
    recApi.getServerChannels(guildId),
    recApi.getLeagueHeaderSummary(guildId).catch(() => null),
  ]).then(([result, header]) => {
    setChannels(result.channels);
    setValues(Object.fromEntries(Object.values(REC_ROUTE_CHANNELS).map((route) => [
      route.inputField,
      String(result.routes[route.dbField] ?? ""),
    ])));
    setIsCfb(header?.league.game === "cfb_27");
    setIsRise(header?.league.rosterType === "rise_to_immortality");
  }).catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load channels."));

  useEffect(() => { void load(); }, [guildId]);

  async function create(key: string, route: (typeof REC_ROUTE_CHANNELS)[keyof typeof REC_ROUTE_CHANNELS]) {
    setBusy(key);
    setError(null);
    try {
      const type = key === "game_channels_category" ? "category" : "text";
      const result = await recApi.createServerChannel({
        guildId,
        routeKey: key,
        name: route.defaultName,
        type,
        templateChannelId: values[route.inputField] || null,
      });
      await load();
      setValues((current) => ({ ...current, [route.inputField]: result.channel.id }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create channel.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await recApi.saveServerChannels({ guildId, ...values });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save channels.");
    } finally {
      setBusy(null);
    }
  }

  async function refreshGuide() {
    setBusy("guide");
    setError(null);
    try {
      const result = await recApi.refreshRecGuide(guildId);
      setSaved(false);
      window.alert(`REC Guide refreshed with ${result.posted} posts.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to refresh the REC Guide.");
    } finally {
      setBusy(null);
    }
  }

  if (!channels && !error) return <LoadingState />;
  return <>
    {error && <ErrorState message={error} />}
    {saved && <p style={{ color: "var(--success)" }}>Channel assignments saved. The REC Guide will refresh automatically.</p>}
    <Card>
      <div className="channel-settings-grid">
        {CONFIGURABLE_ROUTES.map(([key, route]) => {
          const type = key === "game_channels_category" ? "category" : "text";
          return <div className="channel-settings-row" key={key}>
            <label className="form-label" htmlFor={`route-${key}`}>{route.label}</label>
            <select
              id={`route-${key}`}
              className="form-select"
              value={values[route.inputField] ?? ""}
              onChange={(event) => {
                setSaved(false);
                setValues((current) => ({ ...current, [route.inputField]: event.target.value }));
              }}
            >
              <option value="">Not assigned</option>
              {channels?.filter((channel) => channel.type === type).map((channel) => (
                <option value={channel.id} key={channel.id}>#{channel.name}</option>
              ))}
            </select>
            <Button variant="secondary" disabled={busy === key} onClick={() => void create(key, route)}>
              <Plus size={15} /> {busy === key ? "Creating…" : "Create Channel"}
            </Button>
          </div>;
        })}
      </div>
    </Card>
    <div style={{ marginTop: "var(--space-4)" }}>
      <Button variant="primary" disabled={busy === "save"} onClick={() => void save()}>
        {busy === "save" ? "Saving…" : "Save Channel Settings"}
      </Button>
      <Button style={{ marginLeft: "var(--space-2)" }} variant="secondary" disabled={busy === "guide"} onClick={() => void refreshGuide()}>
        {busy === "guide" ? "Refreshing…" : "Wipe & Republish REC Guide"}
      </Button>
    </div>
  </>;
}
