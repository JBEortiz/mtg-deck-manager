export type PurchaseValidationResult =
  | { ok: true; quantity: number; unitPriceUsd: number }
  | { ok: false; message: string };

export function validateWishlistPurchaseInput(quantity: number, unitPriceInput: string, purchasedAt: string): PurchaseValidationResult {
  const normalizedPrice = unitPriceInput.replace(",", ".").trim();
  const unitPriceUsd = Number.parseFloat(normalizedPrice);
  if (!Number.isFinite(unitPriceUsd) || unitPriceUsd < 0) {
    return { ok: false, message: "Precio de compra invalido." };
  }

  const cents = Math.round(unitPriceUsd * 100);
  if (Math.abs(unitPriceUsd * 100 - cents) > 0.001) {
    return { ok: false, message: "El precio solo admite 2 decimales." };
  }

  if (unitPriceUsd > 100000) {
    return { ok: false, message: "El precio unitario es demasiado alto para el MVP." };
  }

  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 999) {
    return { ok: false, message: "La cantidad debe estar entre 1 y 999." };
  }

  const parsedDate = new Date(purchasedAt);
  if (!purchasedAt || !Number.isFinite(parsedDate.getTime())) {
    return { ok: false, message: "Fecha de compra invalida." };
  }

  const now = Date.now();
  if (parsedDate.getTime() > now + 1000 * 60 * 5) {
    return { ok: false, message: "La fecha de compra no puede estar en el futuro." };
  }

  return {
    ok: true,
    quantity: Math.trunc(quantity),
    unitPriceUsd: cents / 100
  };
}
