// Central environment configuration

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getOptionalEnv(name: string, fallback?: string): string | undefined {
  return readEnv(name) ?? fallback;
}

export function getServerConfig() {
  const supabaseUrl = readEnv("SUPABASE_URL") ?? readEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseUrl) throw new Error("Missing required environment variable: SUPABASE_URL");

  return {
    appTitle: getOptionalEnv("NEXT_PUBLIC_APP_TITLE", "B-Bikes Mekaniker Dashboard")!,
    supabaseUrl,
    supabaseServiceRoleKey: getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    bikeDeskApiToken: getRequiredEnv("C1ST_API_TOKEN"),
    bikeDeskApiBaseUrl: getOptionalEnv("C1ST_API_BASE_URL", "https://api.c1st.com/api")!,
    cronSecret: readEnv("CRON_SECRET"),
  };
}

export function getPublicSupabaseConfig() {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL") ?? readEnv("SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return { url, anonKey };
}

export type EnvStatus = {
  supabase: boolean;
  bikeDesk: boolean;
  cronSecret: boolean;
  ready: boolean;
};

export function getEnvStatus(): EnvStatus {
  const supabaseUrl = Boolean(readEnv("SUPABASE_URL") ?? readEnv("NEXT_PUBLIC_SUPABASE_URL"));
  const supabaseKey = Boolean(readEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const bikeDesk = Boolean(readEnv("C1ST_API_TOKEN"));
  const cronSecret = Boolean(readEnv("CRON_SECRET"));

  return {
    supabase: supabaseUrl && supabaseKey,
    bikeDesk,
    cronSecret,
    ready: supabaseUrl && supabaseKey && bikeDesk,
  };
}
