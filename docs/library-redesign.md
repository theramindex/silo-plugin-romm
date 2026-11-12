# Library redesign

Mode: Operate. Reference: RomM's library, within Silo's established theme.

The initial viewport offers platform browsing and a persistent library rail.
Searchable platforms replace the long desktop dropdown. Mobile uses the same
platform overview and a compact navigation drawer. All games, Play in Silo,
and personal collections remain directly accessible.

The gallery has server-side sorting, search, collection and playable filters,
cover density, pagination, and state restored through browser navigation.
Titles are cleaned only for presentation. Missing art uses the game title and
platform in a deliberate cover treatment, with no oversized initial. Cards
show a small positive play indicator only on supported platforms.

Game details occupy the main content area with a back action, cover fallback,
description, available release/genre/player metadata, original filename, and
an honest play or unsupported-platform state. Account and controller-choice
dialogs retain their existing focused behavior. Player/save flows remain intact.

Acceptance: platform navigation and search work at library scale; sort and play
filters reach RomM before pagination; no raw archive extensions in fallback
titles; no broken-image artifacts; no horizontal overflow at phone and desktop
widths; keyboard/gamepad browsing, sign-in, emulator and save smoke tests pass.
