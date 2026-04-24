import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = ["/login", "/auth/callback", "/api/health", "/mfa"];
const MFA_ROUTE = "/mfa";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — required for Server Components to read
  // an up-to-date session. Do not remove this getUser() call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Allow public routes and static assets
  const isPublic =
    PUBLIC_ROUTES.some((route) => pathname.startsWith(route)) ||
    pathname.startsWith("/_next");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // TODO: Re-enable MFA enforcement once Supabase Site URL is configured.
  // MFA enrollment requires a valid Site URL in Supabase Auth config.
  // See: Supabase Dashboard → Authentication → URL Configuration
  //
  // if (user && !isPublic && pathname !== MFA_ROUTE) {
  //   const { data: aal } =
  //     await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  //
  //   if (
  //     aal &&
  //     aal.nextLevel === "aal2" &&
  //     aal.currentLevel === "aal1"
  //   ) {
  //     const url = request.nextUrl.clone();
  //     url.pathname = MFA_ROUTE;
  //     return NextResponse.redirect(url);
  //   }
  // }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match all routes except static files and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
