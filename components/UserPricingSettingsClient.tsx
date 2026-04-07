"use client";

import { useUserPricingPreferences } from "@/lib/use-user-pricing-preferences";
import type { UserPricingPreferences } from "@/lib/types";

type UserPricingSettingsClientProps = {
  initialPreferences?: Partial<UserPricingPreferences>;
};

export default function UserPricingSettingsClient({ initialPreferences }: UserPricingSettingsClientProps) {
  const {
    preferences,
    loading,
    error,
    setPreferredDisplayCurrency,
    setShowPriceFreshness
  } = useUserPricingPreferences({
    preferredDisplayCurrency: "USD",
    showPriceFreshness: true,
    ...initialPreferences
  });

  return (
    <section className="panel content">
      <div className="section-header-inline">
        <div>
          <h2>Preferencias</h2>
          <p className="muted">Controla como se muestran precios y estados de actualizacion.</p>
        </div>
      </div>

      {error && <p className="notice-banner error-banner">{error}</p>}

      <div className="buy-opps-toolbar">
        <label className="field">
          <span>Moneda preferida</span>
          <select
            value={preferences.preferredDisplayCurrency}
            onChange={(event) => void setPreferredDisplayCurrency(event.target.value === "EUR" ? "EUR" : "USD")}
            disabled={loading}
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
        <label className="field">
          <span>Mostrar frescura de precios</span>
          <select
            value={preferences.showPriceFreshness ? "yes" : "no"}
            onChange={(event) => void setShowPriceFreshness(event.target.value === "yes")}
            disabled={loading}
          >
            <option value="yes">Si</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>

      <p className="muted">
        Esta configuracion se aplica en wishlist del deck, Buy Opportunities, Collector Overview y resumen de valor del deck.
      </p>
    </section>
  );
}
