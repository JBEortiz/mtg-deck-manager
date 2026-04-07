import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { formatGoogleUnavailableMessage } from "@/lib/google-auth-errors";
import { getCurrentUser } from "@/lib/server/auth";

type SignUpPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function sanitizeNextPath(nextPath: string | undefined) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/decks";
  }
  return nextPath;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const next = sanitizeNextPath(typeof params.next === "string" ? params.next : undefined);
  const authError = typeof params.authError === "string" ? params.authError : "";
  const authDetail = typeof params.authDetail === "string" ? params.authDetail : "";

  const initialError =
    authError === "google_unavailable" ? formatGoogleUnavailableMessage(authDetail)
    : authError === "google_denied" ? "Has cancelado el acceso con Google."
    : "";

  if (user) {
    redirect(next);
  }

  return <AuthForm mode="sign-up" initialError={initialError} />;
}
