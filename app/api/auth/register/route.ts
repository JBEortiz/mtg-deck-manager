import { AuthError, createSessionForUser, registerUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { confirmPassword?: string; email?: string; password?: string };
    const user = await registerUser({
      email: body.email ?? "",
      password: body.password ?? "",
      confirmPassword: body.confirmPassword ?? ""
    });
    await createSessionForUser(user.id);
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.code === "email_in_use" ? 409 : 400;
      return Response.json({ message: error.message, errors: error.details }, { status });
    }

    const message = error instanceof Error ? error.message : "No se pudo crear la cuenta.";
    return Response.json({ message }, { status: 400 });
  }
}
