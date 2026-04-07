import "server-only";

type JsonBodyParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export async function parseJsonBody<T = unknown>(
  request: Request,
  invalidMessage = "Payload invalido."
): Promise<JsonBodyParseResult<T>> {
  try {
    const parsed = (await request.json()) as T;
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      response: Response.json({ message: invalidMessage }, { status: 400 })
    };
  }
}
