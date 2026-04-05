import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/server/auth";

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/decks";

  if (user) {
    redirect(next);
  }

  return <AuthForm mode="sign-in" />;
}
