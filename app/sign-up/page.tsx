import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/server/auth";

type SignUpPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/decks";

  if (user) {
    redirect(next);
  }

  return <AuthForm mode="sign-up" />;
}
