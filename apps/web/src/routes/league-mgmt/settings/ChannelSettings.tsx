import { useEffect, useState } from "react";
import { REC_ROUTE_CHANNELS, ROUTE_CHANNEL_BLOCKS, type RouteChannelBlock } from "@rec/shared";
import { Plus } from "lucide-react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Modal } from "../../../components/ui/Modal.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type Channel = { id: string; name: string; type: "text" | "category" };
type RouteEntry = [string, (typeof REC_ROUTE_CHANNELS)[keyof typeof REC_ROUTE_CHANNELS]];
const ALL_ROUTES = Object.entries(REC_ROUTE_CHANNELS) as RouteEntry[];

export function ChannelSettings() {
  const { guildId } = useReadyAuth();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRise, setIsRise] = useState(false);
  const [isMadden, setIsMadden] = useState(true);
  const [editBlock, setEditBlock] = useState<RouteChannelBlock | null>(null);
  const [createBlock, setCreateBlock] = useState<RouteChannelBlock | null>(null);
  const [createToggles, setCreateToggles] = useState<Record<string, boolean>>({});

  const CONFIGURABLE_ROUTES = ALL_ROUTES.filter(([, route]) =>
    !("madden_only" in route && route.madden_only && !isMadden) &&
    !("rti_only" in route && route.rti_only && !isRise));

  const load = () => Promise.all([
    recApi.getServerChannels(guildId),
    recApi.getLeagueHeaderSummary(guildId).catch(() => null),
  ]).then(([result, header]) => {
    setChannels(result.channels);
    setValues(Object.fromEntries(Object.values(REC_ROUTE_CHANNELS).map((route) => [
      route.inputField,
      String(result.routes[route.dbField] ?? ""),
    ])));
    setIsRise(header?.league.rosterType === "rise_to_immortality");
    setIsMadden(String(header?.league.game ?? "").startsWith("madden_"));
  }).catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load channels."));

  useEffect(() => { void load(); }, [guildId]);

  async function createOne(key: string, route: RouteEntry[1]) {
    const type = key === "game_channels_category" ? "category" : "text";
    const result = await recApi.createServerChannel({
      guildId,
      routeKey: key,
      name: route.defaultName,
      type,
      templateChannelId: null,
    });
    setValues((current) => ({ ...current, [route.inputField]: result.channel.id }));
  }

  async function saveBlock() {
    setBusy("save");
    setError(null);
    try {
      await recApi.saveServerChannels({ guildId, ...values });
      setNotice("Channel assignments saved.");
      setEditBlock(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save channels.");
    } finally {
      setBusy(null);
    }
  }

  async function runCreateBatch() {
    if (!createBlock) return;
    setBusy("create");
    setError(null);
    try {
      const routes = CONFIGURABLE_ROUTES.filter(([key, route]) => route.block === createBlock && createToggles[key]);
      for (const [key, route] of routes) {
        await createOne(key, route);
      }
      await recApi.saveServerChannels({ guildId, ...values });
      setNotice(`${routes.length} channel${routes.length === 1 ? "" : "s"} created.`);
      setCreateBlock(null);
      setCreateToggles({});
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create channels.");
    } finally {
      setBusy(null);
    }
  }

  if (!channels && !error) return <LoadingState />;

  const blockRoutes = (block: RouteChannelBlock) => CONFIGURABLE_ROUTES.filter(([, route]) => route.block === block);
  const channelName = (channelId: string) => channels?.find((c) => c.id === channelId)?.name ?? null;

  return <>
    {error && <ErrorState message={error} />}
    {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}

    {ROUTE_CHANNEL_BLOCKS.map(({ key: block, label }) => {
      const routes = blockRoutes(block);
      if (!routes.length) return null;
      return (
        <Card key={block} style={{ marginBottom: "var(--space-3)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
            <p style={{ fontWeight: 500, fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</p>
            <button type="button" aria-label={`Edit ${label}`} className="btn-icon" onClick={() => setEditBlock(block)}>
              <Plus size={16} />
            </button>
          </div>
          {routes.map(([key, route]) => {
            const channelId = values[route.inputField];
            const name = channelId ? channelName(channelId) : null;
            return (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "var(--text-sm)", borderTop: "1px solid var(--border)" }}>
                <span>{route.label}</span>
                <span style={{ color: name ? "var(--text-primary)" : "var(--text-muted)", fontWeight: 500 }}>{name ? `#${name}` : "UNASSIGNED"}</span>
              </div>
            );
          })}
        </Card>
      );
    })}

    {editBlock && (
      <Modal title={ROUTE_CHANNEL_BLOCKS.find((b) => b.key === editBlock)?.label ?? "Channels"} onClose={() => setEditBlock(null)}>
        <p className="form-hint" style={{ marginTop: 0 }}>Assign a channel for each item below.</p>
        {blockRoutes(editBlock).map(([key, route]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <label className="form-label" htmlFor={`route-${key}`} style={{ margin: 0 }}>{route.label}</label>
            <select
              id={`route-${key}`}
              className="form-select"
              style={{ maxWidth: 220 }}
              value={values[route.inputField] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [route.inputField]: event.target.value }))}
            >
              <option value="">Not assigned</option>
              {channels?.filter((channel) => channel.type === (key === "game_channels_category" ? "category" : "text")).map((channel) => (
                <option value={channel.id} key={channel.id}>#{channel.name}</option>
              ))}
            </select>
          </div>
        ))}
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button variant="secondary" onClick={() => { setCreateBlock(editBlock); setCreateToggles({}); }}>Create Channel(s)</Button>
          <Button variant="primary" disabled={busy === "save"} onClick={() => void saveBlock()}>{busy === "save" ? "Saving…" : "Save"}</Button>
          <Button variant="ghost" style={{ marginLeft: "auto" }} onClick={() => setEditBlock(null)}>Close</Button>
        </div>
      </Modal>
    )}

    {createBlock && (
      <Modal title="Create Channels" onClose={() => setCreateBlock(null)}>
        <p className="form-hint" style={{ marginTop: 0 }}>Toggle on the channels to create under a new "{ROUTE_CHANNEL_BLOCKS.find((b) => b.key === createBlock)?.label}" category.</p>
        {blockRoutes(createBlock).map(([key, route]) => (
          <label key={key} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "6px 0" }}>
            <input
              type="checkbox"
              checked={Boolean(createToggles[key])}
              onChange={(event) => setCreateToggles((current) => ({ ...current, [key]: event.target.checked }))}
            />
            <span>{route.label}</span>
          </label>
        ))}
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button variant="ghost" onClick={() => setCreateBlock(null)}>Cancel</Button>
          <Button variant="primary" disabled={busy === "create"} onClick={() => void runCreateBatch()}>{busy === "create" ? "Creating…" : "Create"}</Button>
        </div>
      </Modal>
    )}
  </>;
}
