import { createClient } from "@supabase/supabase-js";

let supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables");
}

// If the URL is a dashboard URL, extract the project ref and build the API URL
// e.g. https://supabase.com/dashboard/project/abcdef → https://abcdef.supabase.co
const dashboardMatch = supabaseUrl.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/);
if (dashboardMatch) {
  supabaseUrl = `https://${dashboardMatch[1]}.supabase.co`;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
