import { render } from "preact";
import "./mocks.css";
import { LayoutMocks } from "./layout-mocks";

// Gallery-only document: the preset's reset and tokens, fixture data, no host bridge.
const root = document.getElementById("mocks-root");
if (root) render(<LayoutMocks />, root);
