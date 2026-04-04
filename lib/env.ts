const DEFAULT_C1ST_API_BASE_URL = "https://api.c1st.com/api";

export type EnvPresence = {
  publicSupabaseUrl: boolean;
  resolvedSupabaseUrl: boolean;
  explicitServerSupabaseUrl: boolean;
  supabaseServiceRoleKey: boolean;
  supabaseAnonKey: boolean;
  c1stApiToken: boolean;
  cronSecret: boolean;
  browserAuthReady: boolean;
  dashboardReady: boolean;
  syncReady: boolean;
  schedulerReady: boolean;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveSupabaseUrl() {
  return readEnv("SUPABASE_URL") ?? readEnv("NEXT_PUBLIC_SUPABASE_URL");
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
  const supabaseUrl = resolveSupabaseUrl();
  if (!supabaseUrl) {
    throw new Error("Missing required environment variable: SUPABASE_URL");
  }

  return {
    appTitle: getOptionalEnv("NEXT_PUBLIC_APP_TITLE", "B-Bikes Mekaniker Dashboard")!,
    supabaseUrl,
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

export function getEnvPresence(): EnvPresence {
  const publicSupabaseUrl = Boolean(readEnv("NEXT_PUBLIC_SUPABASE_URL"));
  const resolvedSupabaseUrl = Boolean(resolveSupabaseUrl());
  const explicitServerSupabaseUrl = Boolean(readEnv("SUPABASE_URL"));
  const supabaseServiceRoleKey = Boolean(readEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const supabaseAnonKey = Boolean(readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  const c1stApiToken = Boolean(readEnv("C1ST_API_TOKEN"));
  const cronSecret = Boolean(readEnv("CRON_SECRET"));

  return {
    publicSupabaseUrl,
    resolvedSupabaseUrl,
    explicitServerSupabaseUrl,
    supabaseServiceRoleKey,
    supabaseAnonKey,
    c1stApiToken,
    cronSecret,
    browserAuthReady: publicSupabaseUrl && supabaseAnonKey,
    dashboardReady: resolvedSupabaseUrl && supabaseServiceRoleKey,
    syncReady: resolvedSupabaseUrl && supabaseServiceRoleKey && c1stApiToken,
    schedulerReady: cronSecret,
  };
}

export function getDashboardReadinessMessage(env = getEnvPresence()) {
  if (!env.resolvedSupabaseUrl || !env.supabaseServiceRoleKey) {
    return "Dashboard og server-data mangler Supabase URL eller service role key.";
  }

  return null;
}

export function getSyncReadinessMessage(env = getEnvPresence()) {
  if (!env.resolvedSupabaseUrl || !env.supabaseServiceRoleKey) {
    return "Server-sync mangler Supabase URL eller service role key.";
  }

  if (!env.c1stApiToken) {
    return "Customers 1st-token mangler.";
  }

  return null;
}

export function toOperatorErrorMessage(error: unknown, fallback = "Ukendt fejl.") {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (
    message.includes("Missing required environment variable: SUPABASE_URL") ||
    message.includes("Missing public Supabase configuration")
  ) {
    return "Server-sync mangler Supabase URL.";
  }

  if (message.includes("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY")) {
    return "Server-sync mangler Supabase service role key.";
  }

  if (message.includes("Missing required environment variable: C1ST_API_TOKEN")) {
    return "Customers 1st-token mangler.";
  }

  if (message.includes("Missing required environment variable: CRON_SECRET")) {
    return "Automatisk scheduler mangler cron secret.";
  }

  if (message.includes("Customers 1st request failed with 404")) {
    return "Customers 1st-endpoint blev ikke fundet. Brug api.c1st.com/api som base URL, ikke BikeDesk-webdomænet.";
  }

  if (message.includes("Customers 1st request failed with 500")) {
    return "Customers 1st API svarede 500. Forbindelsen virker, men upstream fejlede under kaldet.";
  }

  return message || fallback;
}
