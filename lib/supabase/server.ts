import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerConfig } from "@/lib/env";

export function createAdminClient() {
  const config = getServerConfig();

  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
