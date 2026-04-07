import "server-only";

import { randomUUID } from "node:crypto";

export const GOOGLE_OAUTH_STATE_COOKIE = "mtg_google_oauth_state";

type GoogleOAuthState = {
  state: string;
  nextPath: string;
  createdAt: string;
};

const GOOGLE_CLIENT_ID_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "AUTH_GOOGLE_ID"
] as const;

const GOOGLE_CLIENT_SECRET_KEYS = [
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_GOOGLE_SECRET"
] as const;

const GOOGLE_REDIRECT_URI_KEYS = [
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GOOGLE_REDIRECT_URI",
  "AUTH_GOOGLE_REDIRECT_URI"
] as const;

function trimEnv(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : "";
}

function readFirstEnv(keys: readonly string[]) {
  for (const key of keys) {
    const value = trimEnv(key);
    if (value) {
      return value;
    }
  }
  return "";
}

function originFromRequest(input?: { requestUrl?: string; requestHeaders?: Headers }) {
  const requestUrl = input?.requestUrl;
  if (requestUrl) {
    try {
      const fromUrl = new URL(requestUrl).origin;
      if (fromUrl) {
        return fromUrl;
      }
    } catch {
      // Continue with proxy/header fallback.
    }
  }

  const forwardedProto = input?.requestHeaders?.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "";
  const forwardedHost = input?.requestHeaders?.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  const host = input?.requestHeaders?.get("host")?.split(",")[0]?.trim() ?? "";

  if (forwardedHost) {
    const proto = forwardedProto || "https";
    return `${proto}://${forwardedHost}`;
  }

  if (host) {
    const proto = forwardedProto || (host.includes("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }

  const fallbackAppBase = trimEnv("APP_BASE_URL") || trimEnv("NEXT_PUBLIC_APP_URL");
  if (!fallbackAppBase) {
    return "";
  }

  try {
    return new URL(fallbackAppBase).origin;
  } catch {
    return "";
  }
}

function normalizeRedirectUri(rawRedirectUri: string, requestOrigin: string) {
  if (!rawRedirectUri) {
    return requestOrigin ? `${requestOrigin}/api/auth/google/callback` : "";
  }

  if (rawRedirectUri.startsWith("/")) {
    return requestOrigin ? new URL(rawRedirectUri, requestOrigin).toString() : "";
  }

  try {
    const parsed = new URL(rawRedirectUri);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

export function getGoogleOAuthConfig(input?: { requestUrl?: string; requestHeaders?: Headers }) {
  const clientId = readFirstEnv(GOOGLE_CLIENT_ID_KEYS);
  const clientSecret = readFirstEnv(GOOGLE_CLIENT_SECRET_KEYS);
  const rawRedirectUri = readFirstEnv(GOOGLE_REDIRECT_URI_KEYS);
  const requestOrigin = originFromRequest(input);
  const redirectUri = normalizeRedirectUri(rawRedirectUri, requestOrigin);

  const missing: string[] = [];
  if (!clientId) {
    missing.push("GOOGLE_OAUTH_CLIENT_ID");
  }
  if (!clientSecret) {
    missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  }

  const issues: string[] = [];
  if (!redirectUri) {
    if (rawRedirectUri) {
      issues.push("GOOGLE_OAUTH_REDIRECT_URI_INVALID");
    } else if (!requestOrigin) {
      issues.push("GOOGLE_OAUTH_REDIRECT_URI_MISSING");
    }
  }

  return {
    enabled: missing.length === 0 && issues.length === 0,
    clientId,
    clientSecret,
    redirectUri
    ,
    missing,
    issues,
    requestOrigin
  };
}

export function buildGoogleConfigErrorDetail(config: ReturnType<typeof getGoogleOAuthConfig>) {
  const detailParts = [...config.missing, ...config.issues];
  return detailParts.length > 0 ? detailParts.join(",") : "GOOGLE_CONFIG_UNKNOWN";
}

export function sanitizeNextPath(nextPath: string | null | undefined) {
  if (!nextPath) {
    return "/decks";
  }

  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/decks";
  }

  return nextPath;
}

export function createGoogleOAuthState(nextPath: string): GoogleOAuthState {
  return {
    state: randomUUID(),
    nextPath: sanitizeNextPath(nextPath),
    createdAt: new Date().toISOString()
  };
}

export function serializeGoogleOAuthState(value: GoogleOAuthState) {
  return JSON.stringify(value);
}

export function parseGoogleOAuthState(value: string | undefined): GoogleOAuthState | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<GoogleOAuthState>;
    if (!parsed.state || typeof parsed.state !== "string") {
      return null;
    }

    return {
      state: parsed.state,
      nextPath: sanitizeNextPath(parsed.nextPath),
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    prompt: "select_account"
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCodeForProfile(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code"
  });

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!tokenResponse.ok) {
    throw new Error("No se pudo validar el token de Google.");
  }

  const tokenPayload = await tokenResponse.json() as {
    access_token?: string;
  };

  const accessToken = tokenPayload.access_token;
  if (!accessToken) {
    throw new Error("Google no devolvio un access token.");
  }

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!profileResponse.ok) {
    throw new Error("No se pudo obtener el perfil de Google.");
  }

  const profile = await profileResponse.json() as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
  };

  if (!profile.sub || !profile.email) {
    throw new Error("Google no devolvio identidad suficiente.");
  }

  return {
    googleSubject: profile.sub,
    email: profile.email,
    emailVerified: profile.email_verified === true
  };
}
