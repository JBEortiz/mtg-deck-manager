import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  buildGoogleConfigErrorDetail,
  buildGoogleAuthorizationUrl,
  createGoogleOAuthState,
  getGoogleOAuthConfig,
  GOOGLE_OAUTH_STATE_COOKIE,
  sanitizeNextPath,
  serializeGoogleOAuthState
} from "@/lib/server/google-oauth";

function buildSignInUrl(authError: string) {
  const params = new URLSearchParams({ authError });
  return `/sign-in?${params.toString()}`;
}

export async function GET(request: Request) {
  const requestHeaders = await headers();
  const config = getGoogleOAuthConfig({ requestUrl: request.url, requestHeaders });
  if (!config.enabled) {
    const signInUrl = new URL(buildSignInUrl("google_unavailable"), request.url);
    signInUrl.searchParams.set("authDetail", buildGoogleConfigErrorDetail(config));
    return NextResponse.redirect(signInUrl);
  }

  const requestUrl = new URL(request.url);
  const nextPath = sanitizeNextPath(requestUrl.searchParams.get("next"));
  const oauthState = createGoogleOAuthState(nextPath);
  const authUrl = buildGoogleAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state: oauthState.state
  });

  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_OAUTH_STATE_COOKIE, serializeGoogleOAuthState(oauthState), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10
  });

  return NextResponse.redirect(authUrl);
}
