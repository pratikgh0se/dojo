# Third-party software shipped with Dojo

For the packaged app's about/licences notice, to be written later.

## Pyodide 0.29.5

- What: the CPython-on-WebAssembly runtime behind the in-browser Python runner (C-PYTHON). Copied unmodified
  from the pinned `pyodide` npm package into the build output at `/pyodide/` (`pyodide.js`, `pyodide.mjs`,
  `pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json`) by `scripts/vendor-pyodide.mjs`.
  Served from the app's own origin; nothing is fetched from a CDN.
- Licence: **MPL-2.0** (Mozilla Public License 2.0), https://github.com/pyodide/pyodide/blob/main/LICENSE
  The files are distributed unmodified, so the MPL's source-availability duty is met by pointing to
  https://github.com/pyodide/pyodide (tag 0.29.5). Embedded components carry their own licences (CPython: PSF-2.0;
  Emscripten runtime: MIT/UIUC). The build ships the full MPL-2.0 text as `/pyodide/LICENSE`; the embedded components' texts are in the repo's `THIRD-PARTY-NOTICES.md`, which supersedes this file.
