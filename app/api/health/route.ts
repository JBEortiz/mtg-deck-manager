import { getHealthText, toRouteResponse } from "@/lib/server/mtg-domain";

export async function GET() {
  return toRouteResponse(await getHealthText());
}
