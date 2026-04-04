import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";

import { getPublicSupabaseConfig } from "@/lib/env";

/**
 * Creates a Supabase client bound to the current request's cookies.
 * Use this in Server Components, Route Handlers, and Server Actions
 * when you need the authenticated user's session.
 *
 * This is separate from `createAdminClient()` in `./server.ts`, which
 * uses the service role key for sync/admin operations and bypasses RLS.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getPublicSupabaseConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component; cookies are read-only here.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getCurrentUserOrNull() {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

export function createUnauthorizedApiResponse(message = "Ikke autoriseret.") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}
