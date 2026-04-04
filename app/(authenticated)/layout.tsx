import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      redirect("/login");
    }
  } catch {
    redirect("/login?error=auth_not_configured");
  }

  return <>{children}</>;
}
