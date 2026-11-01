import { render } from "preact";
import "./preset.css";
import "./preview.css";
import { DeckPreview } from "./deck-preview";

// A separate document keeps the full upstream reset, tokens and portals together.
// No Deck host bridge, persistent store or application boot is loaded here.
const root = document.getElementById("preview-root");
if (root) render(<DeckPreview />, root);
