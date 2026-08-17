import type { ComponentChildren } from "preact";
import "./treatment-direction-review.css";

interface TreatmentDirection {
  readonly label: string;
  readonly summary: string;
  readonly type: string;
  readonly geometry: string;
  readonly structure: string;
}

const NATIVE_BALANCED: TreatmentDirection = {
  label: "Native balanced",
  summary: "Compact native rhythm with a clear three-level reading order.",
  type: "title 14 · body 12.5 · meta 11 · micro 10.5",
  geometry: "rail 275 · frame 34 · status 28",
  structure: "radius 8/10/12 · role-based seams",
};

interface TreatmentDirectionReviewProps {
  renderWindow(): ComponentChildren;
}

/**
 * The canonical treatment retained after the comparison round closed.
 *
 * The caller supplies the real window so this module cannot grow a second
 * chrome fixture. None of its CSS is imported by the shipping renderer.
 */
export function TreatmentDirectionReview({
  renderWindow,
}: TreatmentDirectionReviewProps) {
  return (
    <section class="gx-specimen">
      <header class="gx-specimen__head">
        <span class="gx-specimen__name">canonical treatment</span>
        <span class="gx-specimen__note">
          Native balanced · selected theme · real components · gallery-only
        </span>
      </header>
      <article class="gx-treatment-direction gx-treatment-direction--balanced">
        <header class="gx-treatment-direction__head">
          <div class="gx-treatment-direction__identity">
            <strong>{NATIVE_BALANCED.label}</strong>
            <span>{NATIVE_BALANCED.summary}</span>
          </div>
          <dl class="gx-treatment-direction__spec">
            <div>
              <dt>Type</dt>
              <dd>{NATIVE_BALANCED.type}</dd>
            </div>
            <div>
              <dt>Geometry</dt>
              <dd>{NATIVE_BALANCED.geometry}</dd>
            </div>
            <div>
              <dt>Structure</dt>
              <dd>{NATIVE_BALANCED.structure}</dd>
            </div>
          </dl>
        </header>
        <div class="gx-treatment-direction__window">{renderWindow()}</div>
      </article>
    </section>
  );
}
