import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server-auth";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectTo = typeof params.redirect === "string" && params.redirect.startsWith("/") ? params.redirect : "/";
  const errorCode = typeof params.error === "string" ? params.error : null;

  try {
    const user = await getCurrentUser();
    if (user) {
      redirect(redirectTo);
    }
  } catch {
    // Auth not configured; show the form with a clear message instead.
  }

  const initialError =
    errorCode === "auth_not_configured"
      ? "Supabase Auth er ikke konfigureret. Kontakt administrator."
      : null;

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">B-Bikes</p>
        <h1>Mekaniker Dashboard</h1>
        <p className="muted">Log ind for at se dagens registrerede arbejdstid og rapporter.</p>
        <LoginForm initialError={initialError} redirectTo={redirectTo} />
      </section>
    </main>
  );
}
