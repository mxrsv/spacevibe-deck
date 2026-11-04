import { encode } from "uqr";

/** Quiet zone in modules. The QR spec asks for 4; phone cameras read less reliably with less. */
export const QR_QUIET_ZONE = 4;

/**
 * The QR code as an SVG document: dark modules on a white quiet zone, in every theme. Cameras
 * read dark-on-light; a themed code in a dark theme is inverted and many scanners refuse it, so
 * these two colours are deliberately not tokens. Error correction M (spec MOB1). Modules in a
 * row are merged into one run so the document stays small.
 */
export function qrSvg(text: string): string {
  const { data, size } = encode(text, { ecc: "M", border: 0 });
  const box = size + QR_QUIET_ZONE * 2;
  let path = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x += 1;
      path += `M${start + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h${x - start}v1h-${x - start}z`;
    }
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges">` +
    `<rect width="${box}" height="${box}" fill="white"/><path d="${path}" fill="black"/></svg>`
  );
}

/** Shown as an image, so the code is one opaque picture rather than markup the theme can restyle. */
export function QrCode({ text, label }: { readonly text: string; readonly label: string }) {
  return (
    <img
      class="mobile-qr"
      alt={label}
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text))}`}
    />
  );
}
