type ManaSymbolRowProps = {
  colors: string[];
  emptyLabel?: string;
};

type ManaColorCode = "W" | "U" | "B" | "R" | "G" | "C";

type ManaSymbolConfig = {
  label: string;
  text: string;
  className: string;
};

const MANA_SYMBOLS: Record<ManaColorCode, ManaSymbolConfig> = {
  W: { label: "White", text: "W", className: "mana-symbol-white" },
  U: { label: "Blue", text: "U", className: "mana-symbol-blue" },
  B: { label: "Black", text: "B", className: "mana-symbol-black" },
  R: { label: "Red", text: "R", className: "mana-symbol-red" },
  G: { label: "Green", text: "G", className: "mana-symbol-green" },
  C: { label: "Colorless", text: "C", className: "mana-symbol-colorless" }
};

function isManaColorCode(value: string): value is ManaColorCode {
  return value in MANA_SYMBOLS;
}

export default function ManaSymbolRow({ colors, emptyLabel = "No colors" }: ManaSymbolRowProps) {
  const normalizedColors = colors
    .map((color) => color.trim().toUpperCase())
    .filter((color, index, source) => color.length > 0 && source.indexOf(color) === index)
    .filter(isManaColorCode);

  if (normalizedColors.length === 0) {
    return <span className="mana-symbol-empty">{emptyLabel}</span>;
  }

  return (
    <div className="mana-symbol-row" aria-label={`Deck colors: ${normalizedColors.map((color) => MANA_SYMBOLS[color].label).join(", ")}`}>
      {normalizedColors.map((color) => {
        const symbol = MANA_SYMBOLS[color];
        return (
          <span key={color} className={`mana-symbol ${symbol.className}`} role="img" aria-label={symbol.label} title={symbol.label}>
            {symbol.text}
          </span>
        );
      })}
    </div>
  );
}
