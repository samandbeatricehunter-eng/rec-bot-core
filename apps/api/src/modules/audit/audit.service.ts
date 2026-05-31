import { supabase } from "../../lib/supabase.js";
export async function writeAuditLog(input:{action:string;entityType:string;entityId?:string|null;previousValue?:Record<string,unknown>;newValue?:Record<string,unknown>;reason?:string|null;source?:"internal_import"|"madden_companion_export"|"manual_admin_entry"|"legacy_migration"|"admin_correction";}) {
  const { error } = await supabase.from("rec_audit_logs").insert({ action: input.action, entity_type: input.entityType, entity_id: input.entityId ?? null, previous_value: input.previousValue ?? {}, new_value: input.newValue ?? {}, reason: input.reason ?? null, source: input.source ?? "manual_admin_entry" });
  if (error) console.error("Failed to write REC audit log", error);
}
