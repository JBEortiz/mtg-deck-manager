type CardThumbnailProps = {
  imageUrl?: string | null;
  alt: string;
  size?: "sm" | "md";
  onClick?: (() => void) | undefined;
  title?: string;
};

export default function CardThumbnail({ imageUrl, alt, size = "sm", onClick, title }: CardThumbnailProps) {
  const className = size === "md" ? "card-thumb card-thumb-md" : "card-thumb";
  const content = imageUrl
    ? <img className={className} src={imageUrl} alt={alt} loading="lazy" decoding="async" width={size === "md" ? 84 : 63} height={size === "md" ? 117 : 88} />
    : <div className={`${className} card-thumb-placeholder`}>Sin imagen</div>;

  if (!onClick) {
    return content;
  }

  return (
    <button className="card-thumb-button" type="button" onClick={onClick} title={title ?? "Ampliar carta"}>
      {content}
    </button>
  );
}
