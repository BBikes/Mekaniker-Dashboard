import { redirect } from "next/navigation";

import { OfferNotifier } from "@/components/offer-notifier";
import { getCurrentUser } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      redirect("/login?redirect=/dashboard");
    }
  } catch {
    redirect("/login?error=auth_not_configured");
  }

  return (
    <>
      {children}
      <OfferNotifier />
    </>
  );
}
