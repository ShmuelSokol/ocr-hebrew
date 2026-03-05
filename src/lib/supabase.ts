import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    const url = process.env["NEXT_PUBLIC_SUPABASE_URL"] || "https://ushngszdltlctmqlwgot.supabase.co";
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
    _client = createClient(url, key);
  }
  return _client;
}

// For backward compat: `supabase` is a lazy proxy
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseClient();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

export const BUCKET = "uploads";
