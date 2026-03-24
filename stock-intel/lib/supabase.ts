// TODO: implement in Module 1
import { createBrowserClient } from "@supabase/ssr";

function requireEnv(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing ${key}`);
  }

  return value;
}

const supabaseUrl = requireEnv(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "NEXT_PUBLIC_SUPABASE_URL",
);
const supabaseAnonKey = requireEnv(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
);

export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
