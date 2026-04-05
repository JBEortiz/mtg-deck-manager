import CardThumbnail from "@/components/CardThumbnail";

type DeckCardRowProps = {
  imageUrl?: string | null;
  title: string;
  subtitle: string;
  meta?: string;
  quantity: number;
  mode?: "read" | "edit";
  actions?: React.ReactNode;
  onPreview?: (() => void) | undefined;
  onHoverPreview?: (() => void) | undefined;
  onHoverLeave?: (() => void) | undefined;
};

export default function DeckCardRow({
  imageUrl,
  title,
  subtitle,
  meta,
  quantity,
  mode = "read",
  actions,
  onPreview,
  onHoverPreview,
  onHoverLeave
}: DeckCardRowProps) {
  return (
    <article
      className={`deck-card-row deck-card-row-${mode}`}
      onMouseEnter={onHoverPreview}
      onMouseLeave={onHoverLeave}
    >
      <button className="deck-card-row-main" type="button" onClick={onPreview}>
        {mode === "edit" ? (
          <>
            <CardThumbnail imageUrl={imageUrl} alt={title} size="sm" />
            <div className="deck-card-row-copy">
              <div className="deck-card-row-title">
                <strong className="card-name">{title}</strong>
                <span className="status-badge">{quantity}x</span>
              </div>
              <p className="card-type">{subtitle}</p>
              {meta ? <p className="muted">{meta}</p> : null}
            </div>
          </>
        ) : (
          <div className="deck-card-row-copy deck-card-row-copy-compact">
            <span className="deck-card-row-qty">{quantity}x</span>
            <strong className="card-name">{title}</strong>
          </div>
        )}
      </button>
      {actions ? <div className="deck-card-row-actions">{actions}</div> : null}
    </article>
  );
}
