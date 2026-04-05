import "server-only";

import { getCurrentUser } from "@/lib/server/auth";

export async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) {
    return {
      user: null,
      response: Response.json({ message: "Debes iniciar sesion." }, { status: 401 })
    };
  }

  return { user, response: null };
}
