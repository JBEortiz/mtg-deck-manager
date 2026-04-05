import { AuthError, authenticateUser, createSessionForUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string };
    const user = await authenticateUser({
      email: body.email ?? "",
      password: body.password ?? ""
    });
    await createSessionForUser(user.id);
    return Response.json({ user });
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.code === "invalid_credentials" ? 401 : 400;
      return Response.json({ message: error.message, errors: error.details }, { status });
    }

    const message = error instanceof Error ? error.message : "No se pudo iniciar sesion.";
    return Response.json({ message }, { status: 400 });
  }
}
