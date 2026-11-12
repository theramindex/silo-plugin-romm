# Third-party components

The plugin source uses GPL-3.0-only. Vendored components retain their respective
licenses; this file does not relicense emulator cores or fonts.

- EmulatorJS 4.2.3, GPL-3.0: https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3
  Archive: https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.2.3/4.2.3.7z
  Runtime license: `internal/plugin/emulator/LICENSE`.
- FCEUmm: https://github.com/EmulatorJS/libretro-fceumm
- Snes9x: https://github.com/EmulatorJS/snes9x — its separate personal,
  non-commercial Snes9x license applies. Do not assume this core is GPL.
- Gambatte: https://github.com/EmulatorJS/gambatte-libretro
- mGBA: https://github.com/EmulatorJS/mgba
- Core build source: https://github.com/EmulatorJS/build
  Build timestamps accompany the binaries under `data/cores/reports/`.
  Modern and legacy **non-threaded** builds are included for these four cores.
  Core license texts are in `internal/plugin/emulator/licenses/`.
- Plus Jakarta Sans, SIL Open Font License: copied from the existing Ramindex
  HDHomeRun plugin assets. Original: https://github.com/tokotype/PlusJakartaSans

Local EmulatorJS changes: `checkForUpdates()` returns without network access;
a missing local core reports failure before the upstream CDN fallback. The
readable source accompanies the minified bundle. Rebuild that bundle with
Terser (installed outside this checkout), concatenating these files in order:

```sh
terser internal/plugin/emulator/data/src/{emulator,nipplejs,shaders,storage,gamepad,GameManager,socket.io.min,compression}.js \
  --compress --mangle --comments '/EmulatorJS|[Ll]icense|copyright|[Cc]opyright/' \
  --output internal/plugin/emulator/data/emulator.min.js
```

`emulator-assets.sha256` records the actual files shipped by this build. Keep
license texts and readable source with redistribution. Before a public release,
retain or provide corresponding source for the exact pinned emulator/core builds
under their respective license terms.

Platform SVG illustrations are bundled unmodified from RomM (GPL-3.0), pinned
at commit `3c5bab7a7fab75d7d755c6e44bc29405907cbf03`:
https://github.com/rommapp/romm/tree/3c5bab7a7fab75d7d755c6e44bc29405907cbf03/frontend/assets/platforms
The source reference and upstream attribution text accompany these files in
`internal/plugin/ui/platforms/`. Platform names and artwork identify the
user's systems; the Silo client is published by Ramindex.
