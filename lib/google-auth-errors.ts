const DETAIL_MAP: Record<string, string> = {
  GOOGLE_OAUTH_CLIENT_ID: "Falta configurar GOOGLE_OAUTH_CLIENT_ID (tambien sirve GOOGLE_CLIENT_ID o AUTH_GOOGLE_ID).",
  GOOGLE_OAUTH_CLIENT_SECRET: "Falta configurar GOOGLE_OAUTH_CLIENT_SECRET (tambien sirve GOOGLE_CLIENT_SECRET o AUTH_GOOGLE_SECRET).",
  GOOGLE_OAUTH_REDIRECT_URI_INVALID: "GOOGLE_OAUTH_REDIRECT_URI no es valida. Usa una URL http(s) completa o una ruta relativa como /api/auth/google/callback.",
  GOOGLE_OAUTH_REDIRECT_URI_MISSING: "No se pudo resolver la callback de Google. Define GOOGLE_OAUTH_REDIRECT_URI o APP_BASE_URL y reinicia la app.",
  GOOGLE_CONFIG_UNKNOWN: "La configuracion de Google OAuth es incompleta."
};

export function formatGoogleUnavailableMessage(authDetail: string) {
  if (!authDetail) {
    return "Google auth no esta configurado correctamente en este entorno.";
  }

  const details = authDetail
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (details.length === 0) {
    return "Google auth no esta configurado correctamente en este entorno.";
  }

  const explanation = details
    .map((detail) => DETAIL_MAP[detail] ?? `Detalle de configuracion: ${detail}.`)
    .join(" ");

  return `Google auth no esta disponible. ${explanation} Revisa .env, guarda cambios y reinicia npm run dev.`;
}
