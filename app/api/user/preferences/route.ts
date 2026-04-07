import type { UserPricingPreferences } from "@/lib/types";
import { requireApiUser } from "@/lib/server/auth-route";
import { getUserById, updateStoredUserPricingPreferences } from "@/lib/server/mtg-store";

function normalizeCurrency(value: unknown): "USD" | "EUR" {
  return value === "EUR" ? "EUR" : "USD";
}

function normalizeShowFreshness(value: unknown) {
  return value === false ? false : true;
}

function toPreferences(user: Awaited<ReturnType<typeof getUserById>>): UserPricingPreferences {
  return {
    preferredDisplayCurrency: user?.preferredDisplayCurrency === "EUR" ? "EUR" : "USD",
    showPriceFreshness: user?.showPriceFreshness !== false
  };
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  const user = await getUserById(auth.user.id);
  return Response.json({
    preferences: toPreferences(user)
  });
}

export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (auth.response) {
    return auth.response;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "Payload invalido." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return Response.json({ message: "Payload invalido." }, { status: 400 });
  }

  const body = payload as {
    preferredDisplayCurrency?: unknown;
    showPriceFreshness?: unknown;
  };

  const updated = await updateStoredUserPricingPreferences(auth.user.id, {
    preferredDisplayCurrency: normalizeCurrency(body.preferredDisplayCurrency),
    showPriceFreshness: normalizeShowFreshness(body.showPriceFreshness)
  });

  if (!updated) {
    return Response.json({ message: "Usuario no encontrado." }, { status: 404 });
  }

  return Response.json({
    preferences: toPreferences(updated)
  });
}
