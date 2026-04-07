import { NextResponse } from "next/server";
import { resolveRulesHelperQuery } from "@/lib/server/rules-helper";

type RulesHelperRequestBody = {
  query?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RulesHelperRequestBody;
    const query = typeof body.query === "string" ? body.query : "";
    const result = await resolveRulesHelperQuery(query);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo resolver la consulta ahora mismo.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
