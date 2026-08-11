# Vendored: react-grab

`index.global.js` is copied verbatim from the published npm tarball. It is the
IIFE build, which is the only one that can be injected into a page Deck does
not own.

| Field     | Value                                                                          |
| --------- | ------------------------------------------------------------------------------ |
| Package   | [`react-grab`](https://www.npmjs.com/package/react-grab)                        |
| Version   | `0.1.50`                                                                        |
| File      | `dist/index.global.js`                                                          |
| Bytes     | 386057                                                                          |
| SHA-256   | `G0pDLX1cafQAR421uH6kUJIQQY+veOYL1yHBO/8qWvY=` (base64)                         |
| Tarball   | `sha512-zRkHKq/8a1msCpEOp8BDROeQZT50m0OH2XPrP6jk5op+JAHrlsm3pj7eAQMOsct87EZDeGNnu4r+sGsJJzyw1Q==` |
| License   | MIT — Copyright (c) 2025 Aiden Bai                                              |
| Upstream  | https://github.com/aidenybai/react-grab                                         |

## Why the file is committed instead of `npm install`ed

The script is not part of Deck's own bundle: it is injected into **someone
else's page**, the one loaded in the browser panel. Nothing in the renderer or
the host imports it, so a dependency entry would buy no type checking, no tree
shaking and no bundling — only a `react >= 17` peer on a repo that has no React,
plus `bippy` and `@react-grab/cli` in the tree.

Committing the exact file also means the bytes that run inside a user's page
are the bytes reviewed here, and they keep working with no network. The
alternative in the README — a `//unpkg.com/react-grab/...` script tag — would
make Inspect require the internet and put a third-party fetch in the path of
every page load.

`dist/styles.css` is deliberately NOT vendored: the IIFE build inlines its own
styles (verified — the CSS class names appear inside `index.global.js`), so the
separate stylesheet is only needed by the ESM entry.

## Upgrading

1. `npm pack react-grab@<version>` (or download the tarball from the registry).
2. Copy `package/dist/index.global.js` over the file here.
3. Update the version, byte count and SHA-256 in the table above.
4. Update `EXPECTED_SHA256` in `electron/browser/vendor.test.ts` — that test is
   what fails if the file and this record ever disagree.
5. Re-check the bootstrap in `electron/browser/inject.ts` against the new
   build: it depends on three published names — the `__REACT_GRAB_MODULE__`
   global, `init(options)` and the `getContent` option.
