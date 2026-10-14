import type { FaqItem } from '@/strings/en';

export function Faq({ title, items }: { title: string; items: FaqItem[] }) {
  return (
    <section className="section">
      <div className="wrap">
        <h2 className="section-title">{title}</h2>
        <div className="faq">
          {items.map((f) => (
            <details key={f.q} className="card">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
