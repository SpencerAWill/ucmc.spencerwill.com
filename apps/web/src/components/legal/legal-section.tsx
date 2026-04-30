import type { LegalSection } from "#/config/legal";

/**
 * Renders a single section of legal copy from `LegalSection` data.
 * Headings stay as `<h2>` so the page's `<h1>` provides the document
 * outline for screen readers. Paragraphs, bullets, and references each
 * map to standard semantic elements with no extra ARIA — the simpler
 * the markup, the easier `axe-core` and assistive tech can parse it.
 */
export function LegalSectionView({ section }: { section: LegalSection }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">
        {section.heading}
      </h2>
      {section.paragraphs?.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed">
          {p}
        </p>
      ))}
      {section.bullets ? (
        <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed">
          {section.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : null}
      {section.references && section.references.length > 0 ? (
        <ul className="ml-5 list-disc space-y-1 text-sm">
          {section.references.map((r) => (
            <li key={r.href}>
              <a
                href={r.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                {r.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Renders an array of `LegalSection`s with consistent spacing. Intended
 * for the body of `/disclaimer`, `/nondiscrimination`, `/anti-hazing`,
 * and `/waiver`.
 */
export function LegalSections({
  sections,
}: {
  sections: readonly LegalSection[];
}) {
  return (
    <div className="space-y-8">
      {sections.map((s) => (
        <LegalSectionView key={s.heading} section={s} />
      ))}
    </div>
  );
}
