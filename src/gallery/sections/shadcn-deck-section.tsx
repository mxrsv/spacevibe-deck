import { SectionHead } from "../specimen";

const PREVIEW_URL = "/src/gallery/shadcn-preview/index.html";

export function ShadcnDeckSection() {
  return (
    <>
      <SectionHead
        title="Deck with shadcn"
        blurb="Mira · Stone / Blue · Base UI. Sample data; use the preview's theme switch independently of the gallery theme."
      />
      <p style={{ margin: "0 0 16px" }}>
        <a href={PREVIEW_URL} target="_blank" rel="noreferrer">
          Open full-window preview ↗
        </a>
      </p>
      <iframe
        src={PREVIEW_URL}
        title="Interactive Deck shadcn overview"
        style={{ width: "100%", height: "780px", border: "0", display: "block" }}
      />
    </>
  );
}
