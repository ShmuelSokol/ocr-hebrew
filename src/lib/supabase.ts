import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ushngszdltlctmqlwgot.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "dummy-key-for-build";

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const BUCKET = "uploads";
