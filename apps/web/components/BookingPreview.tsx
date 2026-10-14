/** Picture of a customer booking page (sample data from the wireframes). Decorative only. */
export function BookingPreview({
  business,
  subtitle,
  rows,
  button,
}: {
  business: string;
  subtitle: string;
  rows: [string, string][];
  button: string;
}) {
  return (
    <div className="card preview" aria-hidden="true">
      <div className="preview-title">{business}</div>
      <div className="preview-sub muted">{subtitle}</div>
      {rows.map(([left, right]) => (
        <div key={left} className="preview-row">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      ))}
      <span className="btn">{button}</span>
    </div>
  );
}
