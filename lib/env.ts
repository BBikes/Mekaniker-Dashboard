const DEFAULT_C1ST_API_BASE_URL = "https://api.c1st.com/api";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getOptionalEnv(name: string, fallback?: string): string | undefined {
  return readEnv(name) ?? fallback;
}

export function getServerConfig() {
  return {
    appTitle: getOptionalEnv("NEXT_PUBLIC_APP_TITLE", "B-Bikes Mekaniker Dashboard")!,
    supabaseUrl: getRequiredEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    c1stApiToken: getRequiredEnv("C1ST_API_TOKEN"),
    c1stApiBaseUrl: getOptionalEnv("C1ST_API_BASE_URL", DEFAULT_C1ST_API_BASE_URL)!,
    c1stDefaultPageLength: Number.parseInt(getOptionalEnv("C1ST_DEFAULT_PAGE_LENGTH", "200")!, 10),
    c1stUseUpdatedAfter: getOptionalEnv("C1ST_USE_UPDATED_AFTER", "false") === "true",
    c1stUpdatedAfterParam: getOptionalEnv("C1ST_UPDATED_AFTER_PARAM", "updated_after")!,
    c1stExtraTicketMaterialQuery: getOptionalEnv("C1ST_EXTRA_TICKET_MATERIAL_QUERY", "")!,
  };
}

export function getPublicSupabaseConfig() {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL") ?? readEnv("SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!url || !anonKey) {
    throw new Error(
      "Missing public Supabase configuration. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return { url, anonKey };
}

export function getEnvPresence() {
  return {
    supabaseUrl: Boolean(readEnv("NEXT_PUBLIC_SUPABASE_URL") ?? readEnv("SUPABASE_URL")),
    supabaseServiceRoleKey: Boolean(readEnv("SUPABASE_SERVICE_ROLE_KEY")),
    supabaseAnonKey: Boolean(readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")),
    c1stApiToken: Boolean(readEnv("C1ST_API_TOKEN")),
    cronSecret: Boolean(readEnv("CRON_SECRET")),
  };
}
