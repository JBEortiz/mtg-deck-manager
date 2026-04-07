import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { formatGoogleUnavailableMessage } from "@/lib/google-auth-errors";
import { getCurrentUser } from "@/lib/server/auth";

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function sanitizeNextPath(nextPath: string | undefined) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/decks";
  }
  return nextPath;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const next = sanitizeNextPath(typeof params.next === "string" ? params.next : undefined);
  const authError = typeof params.authError === "string" ? params.authError : "";
  const authDetail = typeof params.authDetail === "string" ? params.authDetail : "";
  const notice = typeof params.notice === "string" ? params.notice : "";

  const initialError =
    authError === "google_unavailable" ? formatGoogleUnavailableMessage(authDetail)
    : authError === "google_denied" ? "Has cancelado el acceso con Google."
    : authError === "google_callback_invalid" ? "No pudimos completar el retorno de Google."
    : authError === "google_state_invalid" ? "Tu sesion de Google caduco. Intentalo de nuevo."
    : authError === "google_exchange_failed" ? "No se pudo validar tu cuenta de Google."
    : "";

  const initialInfo =
    notice === "email_unverified"
      ? "Tu email aun no esta verificado. Puedes seguir usando la app con normalidad."
      : "";

  if (user) {
    redirect(next);
  }

  return <AuthForm mode="sign-in" initialError={initialError} initialInfo={initialInfo} />;
}
