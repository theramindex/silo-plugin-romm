# RomM for Silo

Games from your RomM server, in a full-page Silo plugin. Browse platforms,
collections and search results, then play NES, SNES, Game Boy, Game Boy Color
and Game Boy Advance games using bundled EmulatorJS 4.2.3. No iframe, ROMs,
BIOS files, CDN runtime or remote emulator cores.

## Setup

Install a platform-specific `.silo-plugin.zip` on the Ramindex Silo fork and
set **RomM server → URL** in the plugin settings. The URL must be reachable
from the Silo server, including private LAN addresses when appropriate.

Open **Games** and choose **Sign in to RomM**. RomM opens in a separate tab;
sign in with your usual account or OIDC/SSO provider and approve **Silo Games**.
Check that the approval code matches the plugin. The plugin then verifies your
RomM identity and saves an encrypted connection for the active Silo profile.
Keep the Games page open until it confirms the connection. Cancelled, declined
or expired requests do not create a connection.

The configured address must be reachable from both Silo and your browser for
this flow. Browser approval uses RomM's `/api/auth/device/` endpoints, verified
against RomM 5.4. If unavailable, expand **Use a token or pairing code**. Required
scopes: `me.read`, `roms.read`, `platforms.read`, `collections.read`,
`firmware.read`, `assets.read`, `assets.write`. No Silo or RomM password is stored.
Pending approval credentials stay in server memory and expire; only a completed,
verified connection is written to disk. A plugin restart requires starting any
unfinished approval again. Saved connections continue to survive restarts.

Every Silo account/profile has its own explicit RomM connection. Names and
email addresses never determine identity. OIDC login in RomM can complete browser approval; a Silo login by itself does
not authorize access to RomM. Reconnecting or
changing the configured server invalidates old player sessions.

## Progress

Save files and save states sync to the connected RomM user. A session pins the
ROM, user and exact emulator version; another profile cannot reuse its ticket.
Only matching emulator versions resume automatically. Existing saves made by
a different RomM client/core are retained and are not automatically imported.

Progress is captured every 30 seconds, on Save progress, on page hiding,
and during Save & exit. Pending uploads are first stored in a profile/game
specific IndexedDB outbox; a failed upload retries when that game is reopened
with the same connection. **Save & exit** waits for acknowledgement. A failed
sync lets you explicitly leave with local progress. Browser termination and
power loss can lose progress since the last completed local capture. Clearing
site data also removes pending local progress. Keep the connection until
pending progress has synced; reconnecting intentionally creates a new namespace.

ROM downloads use the Ramindex Silo authenticated loopback relay. Progress
uploads use bounded chunks under Silo's gRPC request limit. ROMs are limited
to 64 MiB and each save/state to 16 MiB. The initial cores do not require
threaded SharedArrayBuffer or COOP/COEP. The dedicated player document permits
`unsafe-eval` for the pinned Emscripten wrapper; the library document does not.
A CSP meta policy survives Silo's response-header filtering.

## Persistent storage

Mount `/var/lib/continuum/plugins/silo.ramindex.romm` persistently and give the
plugin process write access. `ROMM_DATA_DIR` overrides it. Links are encrypted
with AES-GCM using `credentials.key`; both that key and `links.json` must be
backed up together. Losing the key requires reconnecting accounts. Tokens stay
server-side and do not appear in browser responses or error messages. The
plugin is intended for one Silo server using this data directory.

Library and account requests have an eight-second budget so an unavailable
RomM returns a JSON error before Silo's route deadline. A timeout keeps the
saved account connection intact; retry after restoring connectivity. Seeing
an account under **Account** confirms the saved link, not current server
reachability. Large game and save downloads use the separate content relay.

## Development

```sh
go test -race ./...
go vet ./...
./scripts/verify-release.sh
./scripts/build-release.sh
```

The local fixture harness uses an original NES diagnostic cartridge that shows
a blue screen. It never connects to a real RomM account:

```sh
go run ./cmd/devserver --fixture
# In another terminal, with Playwright installed:
PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/browser-smoke.cjs
```

The browser test covers controller-oriented browsing, mobile/light layouts,
actual WASM startup, save/state upload, resume, and offline retry. Live testing
against your RomM deployment and physical gamepads remains a deployment check.

## Release

This checkout follows Ramindex's automatic Conventional Commit release setup.
A push of `feat`/`fix` to main ships a release and updates the catalog. Use
`ramindex-ci <github@ramindex.org>` and the Ramindex GitHub App for publishing.
Release assets and catalog entries are published by the workflows in
[theramindex/silo-plugin-romm](https://github.com/theramindex/silo-plugin-romm).
Server installation and account linking are separate from publishing a release.

See [THIRD_PARTY.md](THIRD_PARTY.md) for runtime and core license/source details.
