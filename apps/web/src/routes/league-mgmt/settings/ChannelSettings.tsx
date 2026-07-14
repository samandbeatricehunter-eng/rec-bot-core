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
export function ChannelSettings() {
  const { guildId } = useReadyAuth(); const [channels, setChannels] = useState<Channel[] | null>(null); const [values, setValues] = useState<Record<string, string>>({}); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  const load = () => recApi.getServerChannels(guildId).then((r) => { setChannels(r.channels); setValues(Object.fromEntries(Object.values(REC_ROUTE_CHANNELS).map((route) => [route.inputField, String(r.routes[route.dbField] ?? "")]))); }).catch((e) => setError(e instanceof Error ? e.message : "Failed to load channels."));
  useEffect(() => { void load(); }, [guildId]);
  async function create(key: string, route: (typeof REC_ROUTE_CHANNELS)[keyof typeof REC_ROUTE_CHANNELS]) { setBusy(key); setError(null); try { const type = key === "game_channels_category" ? "category" : "text"; const templateChannelId = values[route.inputField] || null; const result = await recApi.createServerChannel({ guildId, routeKey: key, name: route.defaultName, type, templateChannelId }); await load(); setValues((v) => ({ ...v, [route.inputField]: result.channel.id })); } catch (e) { setError(e instanceof Error ? e.message : "Failed to create channel."); } finally { setBusy(null); } }
  async function save() { setBusy("save"); setError(null); try { await recApi.saveServerChannels({ guildId, ...values }); setSaved(true); } catch (e) { setError(e instanceof Error ? e.message : "Failed to save channels."); } finally { setBusy(null); } }
  if (!channels && !error) return <LoadingState />;
  return <>{error && <ErrorState message={error} />}{saved && <p style={{ color: "var(--success)" }}>Channel assignments saved. The REC Guide will refresh automatically.</p>}<Card><div className="channel-settings-grid">{Object.entries(REC_ROUTE_CHANNELS).map(([key, route]) => { const type = key === "game_channels_category" ? "category" : "text"; return <div className="channel-settings-row" key={key}><label className="form-label" htmlFor={`route-${key}`}>{route.label}</label><select id={`route-${key}`} className="form-select" value={values[route.inputField] ?? ""} onChange={(e) => { setSaved(false); setValues((v) => ({ ...v, [route.inputField]: e.target.value })); }}><option value="">Not assigned</option>{channels?.filter((c) => c.type === type).map((c) => <option value={c.id} key={c.id}>#{c.name}</option>)}</select><Button variant="secondary" disabled={busy === key} onClick={() => create(key, route)}><Plus size={15} /> {busy === key ? "Creating…" : "Create Channel"}</Button></div>; })}</div></Card><div style={{ marginTop: "var(--space-4)" }}><Button variant="primary" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : "Save Channel Settings"}</Button></div></>;
}
