import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { authenticateGoogleUser, createSessionForUser } from "@/lib/server/auth";
import {
  buildGoogleConfigErrorDetail,
  exchangeGoogleCodeForProfile,
  getGoogleOAuthConfig,
  GOOGLE_OAUTH_STATE_COOKIE,
  parseGoogleOAuthState
} from "@/lib/server/google-oauth";

function redirectToSignIn(request: Request, authError: string, authDetail?: string) {
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("authError", authError);
  if (authDetail) {
    url.searchParams.set("authDetail", authDetail);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const requestHeaders = await headers();
  const config = getGoogleOAuthConfig({ requestUrl: request.url, requestHeaders });
  if (!config.enabled) {
    return redirectToSignIn(request, "google_unavailable", buildGoogleConfigErrorDetail(config));
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.searchParams.get("error")) {
    return redirectToSignIn(request, "google_denied");
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state) {
    return redirectToSignIn(request, "google_callback_invalid");
  }

  const cookieStore = await cookies();
  const stateCookie = parseGoogleOAuthState(cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value);
  cookieStore.delete(GOOGLE_OAUTH_STATE_COOKIE);

  if (!stateCookie || stateCookie.state !== state) {
    return redirectToSignIn(request, "google_state_invalid");
  }

  try {
    const profile = await exchangeGoogleCodeForProfile({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri
    });

    const user = await authenticateGoogleUser(profile);
    await createSessionForUser(user.id);

    return NextResponse.redirect(new URL(stateCookie.nextPath, request.url));
  } catch {
    return redirectToSignIn(request, "google_exchange_failed");
  }
}
