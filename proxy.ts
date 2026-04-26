import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";

const PUBLIC_PATHS = ["/login", "/_next", "/favicon.ico", "/dashboard", "/api/dashboard"];
const PUBLIC_FILE_PATTERN = /.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/;

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((publicPath) => pathname.startsWith(publicPath)) || PUBLIC_FILE_PATTERN.test(pathname);
}

function createAuthConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

function isAuthorizedCronRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname === "/api/cron/sync" && isAuthorizedCronRequest(request)) {
    return NextResponse.next();
  }

  const authConfig = createAuthConfig();
  if (!authConfig) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Auth er ikke konfigureret." }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "auth_not_configured");
    return NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(authConfig.url, authConfig.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Ikke autoriseret." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") {
    loginUrl.searchParams.set("redirect", pathname);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
