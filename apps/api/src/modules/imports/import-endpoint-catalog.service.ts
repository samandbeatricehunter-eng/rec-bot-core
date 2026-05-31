import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export async function listImportEndpointCatalog() {
  const result = await supabase
    .from("rec_import_endpoint_catalog")
    .select("*")
    .eq("enabled", true)
    .eq("admin_only", false)
    .order("sort_order", { ascending: true });

  if (result.error) {
    throw new ApiError(500, "Failed to load import endpoint catalog.", result.error);
  }

  return { endpoints: result.data ?? [] };
}

export async function getDefaultImportEndpointKeys() {
  const result = await supabase
    .from("rec_import_endpoint_catalog")
    .select("endpoint_key")
    .eq("enabled", true)
    .eq("admin_only", false)
    .eq("default_selected", true)
    .order("sort_order", { ascending: true });

  if (result.error) {
    throw new ApiError(500, "Failed to load default import endpoints.", result.error);
  }

  return (result.data ?? []).map((endpoint) => endpoint.endpoint_key as string);
}
