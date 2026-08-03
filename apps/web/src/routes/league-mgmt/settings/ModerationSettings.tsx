import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type ModerationData = {
  bans: Array<{ id:string; username:string|null; display_name:string|null; scope:string; reason:string; active:boolean; currently_active:boolean }>;
  restrictions: Array<{ id:string; username:string|null; display_name:string|null; restriction_type:string; reason:string; active:boolean; currently_active:boolean }>;
  suspensions: Array<{ id:string; target_type:"user"|"player"; username:string|null; display_name:string|null; player_name:string|null; position:string|null; team_name:string|null; start_week:number; end_week:number; season_number:number; reason:string; active:boolean }>;
  audit: Array<{ id:string; action:string; target_username:string|null; reason:string|null; created_at:string }>;
};

export function ModerationSettings() {
  const { guildId } = useReadyAuth();
  const [data,setData]=useState<ModerationData|null>(null), [target,setTarget]=useState(""), [reason,setReason]=useState("");
  const [targets,setTargets]=useState<Array<{value:string;label:string}>>([]), [players,setPlayers]=useState<Array<{id:string;full_name:string;position:string;team_name:string}>>([]);
  const [duration,setDuration]=useState<"week"|"season"|"permanent"|"custom">("week"), [customDays,setCustomDays]=useState("7");
  const [scope,setScope]=useState<"league"|"owner_all_leagues">("league"), [kickScope,setKickScope]=useState<"league"|"server"|"both">("both"), [restrictionType,setRestrictionType]=useState<"wagers"|"highlights">("wagers");
  const [suspensionType,setSuspensionType]=useState<"user"|"player">("user"), [selectedPlayerIds,setSelectedPlayerIds]=useState<string[]>([]), [startWeek,setStartWeek]=useState("1"), [weekCount,setWeekCount]=useState("1");
  const [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false);
  const reload=()=>recApi.listModeration(guildId).then(setData).catch((cause)=>setError(cause instanceof Error?cause.message:"Could not load moderation."));
  useEffect(()=>{ void reload(); void recApi.listModerationTargets(guildId).then((r)=>setTargets(r.targets??[])); void recApi.listSuspensionPlayers(guildId).then((r)=>setPlayers(r.players??[])); },[guildId]);
  const days=duration==="week"?7:duration==="season"?120:duration==="custom"?Math.max(1,Number(customDays)||1):null;
  const expiresAt=days?new Date(Date.now()+days*86_400_000).toISOString():null;
  async function act(action:()=>Promise<unknown>){setBusy(true);setError(null);try{await action();setTarget("");setReason("");setSelectedPlayerIds([]);await reload();}catch(cause){setError(cause instanceof Error?cause.message:"Moderation action failed.");}finally{setBusy(false);}}
  const ready=Boolean(target&&reason.trim().length>=3);
  return <div className="settings-moderation">
    {error?<ErrorState message={error}/>:null}
    <Card><h2>Ban, kick, or restrict a user</h2>
      <div className="form-field"><label className="form-label">Username or Discord user</label><select className="form-select" value={target} onChange={(e)=>setTarget(e.target.value)}><option value="">Select a user</option>{targets.map((r)=><option key={`${r.value}:${r.label}`} value={r.value}>{r.label}</option>)}</select></div>
      <div className="form-field"><label className="form-label">Reason</label><textarea className="form-input" rows={3} value={reason} onChange={(e)=>setReason(e.target.value)}/></div>
      <div className="form-field"><label className="form-label">Duration</label><select className="form-select" value={duration} onChange={(e)=>setDuration(e.target.value as typeof duration)}><option value="week">1 Week</option><option value="season">1 Season</option><option value="permanent">Permanent</option><option value="custom">Custom (# of Days)</option></select>{duration==="custom"?<input className="form-input" type="number" min={1} value={customDays} onChange={(e)=>setCustomDays(e.target.value)}/>:null}</div>
      <div className="form-field"><label className="form-label">Ban scope</label><select className="form-select" value={scope} onChange={(e)=>setScope(e.target.value as typeof scope)}><option value="league">This league + linked Discord server</option><option value="owner_all_leagues">All leagues I own + all linked servers</option></select></div>
      <Button variant="danger" disabled={busy||!ready} onClick={()=>void act(()=>recApi.createModerationBan({guildId,target,reason,scope,expiresAt}))}>Ban user</Button><hr/>
      <div className="form-field"><label className="form-label">Kick scope</label><select className="form-select" value={kickScope} onChange={(e)=>setKickScope(e.target.value as typeof kickScope)}><option value="both">League and Discord server</option><option value="league">League only</option><option value="server">Discord server only</option></select></div>
      <Button variant="danger" disabled={busy||!ready} onClick={()=>void act(()=>recApi.kickModerationUser({guildId,target,reason,scope:kickScope}))}>Kick user</Button><hr/>
      <div className="form-field"><label className="form-label">Restriction</label><select className="form-select" value={restrictionType} onChange={(e)=>setRestrictionType(e.target.value as typeof restrictionType)}><option value="wagers">Wagers</option><option value="highlights">Highlight submissions</option></select></div>
      <Button variant="secondary" disabled={busy||!ready} onClick={()=>void act(()=>recApi.createModerationRestriction({guildId,target,reason,restrictionType,expiresAt}))}>Apply restriction</Button>
    </Card>
    <Card><h2>Suspend a user or player(s)</h2><p className="form-hint">A reason is required. User suspensions block league-affecting actions for the selected week(s); player suspensions mark roster players ineligible. The league receives a public headline.</p>
      <div className="form-field"><label className="form-label">Target type</label><select className="form-select" value={suspensionType} onChange={(e)=>setSuspensionType(e.target.value as typeof suspensionType)}><option value="user">User</option><option value="player">Player(s)</option></select></div>
      {suspensionType==="player"?<div className="form-field"><label className="form-label">Players</label><select className="form-select" multiple size={8} value={selectedPlayerIds} onChange={(e)=>setSelectedPlayerIds(Array.from(e.currentTarget.selectedOptions,(o)=>o.value))}>{players.map((p)=><option key={p.id} value={p.id}>{p.team_name} · {p.position} · {p.full_name}</option>)}</select></div>:<p className="form-hint">Uses the selected user above.</p>}
      <div className="settings-grid settings-grid--2"><div className="form-field"><label className="form-label">Starting week</label><input className="form-input" type="number" min={1} value={startWeek} onChange={(e)=>setStartWeek(e.target.value)}/></div><div className="form-field"><label className="form-label">Number of weeks</label><input className="form-input" type="number" min={1} value={weekCount} onChange={(e)=>setWeekCount(e.target.value)}/></div></div>
      <Button variant="danger" disabled={busy||reason.trim().length<3||(suspensionType==="user"?!target:!selectedPlayerIds.length)} onClick={()=>void act(()=>recApi.suspendLeagueTargets({guildId,targetType:suspensionType,target:suspensionType==="user"?target:undefined,playerIds:suspensionType==="player"?selectedPlayerIds:undefined,startWeek:Math.max(1,Number(startWeek)||1),weekCount:Math.max(1,Number(weekCount)||1),reason}))}>Apply suspension</Button>
    </Card>
    <Card><h2>Active bans</h2>{data?.bans.filter((r)=>r.currently_active).map((r)=><div className="moderation-row" key={r.id}><span><strong>{r.username??r.display_name??"User"}</strong> · {r.scope}<small>{r.reason}</small></span><Button variant="secondary" disabled={busy} onClick={()=>void act(()=>recApi.liftModerationBan({guildId,banId:r.id}))}>Lift</Button></div>)}</Card>
    <Card><h2>Restrictions</h2>{data?.restrictions.filter((r)=>r.currently_active).map((r)=><div className="moderation-row" key={r.id}><span><strong>{r.username??r.display_name??"User"}</strong> · {r.restriction_type}<small>{r.reason}</small></span><Button variant="secondary" disabled={busy} onClick={()=>void act(()=>recApi.liftModerationRestriction({guildId,restrictionId:r.id}))}>Lift</Button></div>)}</Card>
    <Card><h2>Suspensions</h2>{data?.suspensions.filter((r)=>r.active).map((r)=><div className="moderation-row" key={r.id}><span><strong>{r.target_type==="player"?`${r.player_name} (${r.position}, ${r.team_name})`:r.username??r.display_name??"User"}</strong> · S{r.season_number} W{r.start_week}{r.end_week===r.start_week?"":`–${r.end_week}`}<small>{r.reason}</small></span><Button variant="secondary" disabled={busy} onClick={()=>void act(()=>recApi.liftModerationSuspension({guildId,suspensionId:r.id}))}>Lift</Button></div>)}</Card>
    <Card><h2>Audit log</h2>{data?.audit.map((r)=><div className="moderation-row" key={r.id}><span><strong>{r.action}</strong> · {r.target_username??"User"}<small>{r.reason??new Date(r.created_at).toLocaleString()}</small></span></div>)}</Card>
  </div>;
}
