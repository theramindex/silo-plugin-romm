---
name: RomM for Silo
description: A platform-first personal games library within the Silo plugin family.
colors:
  primary: "var(--accent)"
  on-primary: "var(--on-accent)"
  background: "var(--bg)"
  navigation: "var(--rail)"
  surface: "var(--panel)"
  surface-raised: "var(--panel-2)"
  border: "var(--border)"
  text: "var(--text)"
  text-muted: "var(--muted)"
  danger: "var(--danger)"
typography:
  headline:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  detail-headline:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3.2vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
  label:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
  card-title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 650
    lineHeight: 1.45
rounded:
  navigation: "7px"
  control: "8px"
  cover: "10px"
  container: "12px"
  dialog: "16px"
spacing:
  compact: "8px"
  field: "12px"
  group: "16px"
  content: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  navigation-item:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.navigation}"
    padding: "10px"
  navigation-item-current:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.primary}"
    rounded: "{rounded.navigation}"
    padding: "10px"
  cover:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.cover}"
  platform-art:
    backgroundColor: "color-mix(in srgb, var(--panel) 84%, var(--text))"
    rounded: "{rounded.container}"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "32px"
---

# Design System: RomM for Silo

## Overview

**Creative North Star: "The Silo Library"**

RomM presents a platform-first personal games library within Silo's existing visual language. A searchable navigation rail and illustrated platform overview help you choose a system or Play in Silo before browsing covers, opening a full detail page, and playing or resuming a game. Genuine game artwork and bundled RomM platform illustrations supply the character; the surrounding interface stays calm, familiar and content-led.

Dark and light themes share the same geometry and bundled typography. Compact controls, explicit state text and visible focus support keyboard, touch and controller access. The player keeps this control language while giving the game the remaining viewport.

**Key Characteristics:**

- Semantic Silo colors with coherent dark and light fallbacks.
- One bundled type family for headings, content and controls.
- A searchable platform rail, illustrated platform tiles and cover-led galleries.
- Title-led full detail pages, labeled controls and explicit play or progress states.

The built source of truth is [app.css](internal/plugin/ui/app.css), [app.js](internal/plugin/ui/app.js) and the [bundled platform illustrations](internal/plugin/ui/platforms). This refresh preserves the incumbent family identity and records the user-chosen RomM-like library direction in [.impeccable.md](.impeccable.md) and [library-redesign.md](docs/library-redesign.md). [PRODUCT.md](PRODUCT.md) supplies the durable Silo theme, readability and input-access commitments.

## Colors

The palette uses Silo's semantic custom properties rather than a separate game brand palette. The frontmatter references the resolved aliases in the stylesheet; the theme changes their values together.

### Primary

- **Primary / On Primary:** the inverse pair for the principal action. The dark fallback uses a pale action surface; the light fallback uses a dark one. Current navigation uses the primary foreground treatment on a raised neutral surface.
- **Danger:** error text, error boundaries and account disconnection actions.

### Neutral

- **Background:** the page ground.
- **Navigation:** the header and persistent platform rail ground.
- **Surface / Surface Raised:** fields, buttons, dialogs, cover fallbacks, selected navigation and transient notices.
- **Border:** quiet separators and control boundaries.
- **Text / Muted Text:** primary content and supporting metadata.

Platform illustrations retain their own artwork colors. Their overview ground mixes surface and text to keep dark hardware visible in both themes; it is a functional artwork support, not a new brand color.

**The Theme Alias Rule.** Reuse the existing semantic aliases so foreground, background and borders change as a coherent theme.

## Typography

**Display Font:** Plus Jakarta Sans, with the UI sans-serif fallback stack.
**Body Font:** the same bundled family; no competing display face.

**Character:** compact sans-serif typography keeps artwork prominent and controls legible. Weight and restrained negative heading tracking establish hierarchy; metadata uses quieter color rather than another type family.

### Hierarchy

- **Headline:** responsive library and connection headings use the frontmatter headline role. Mobile library headings settle at (1.75rem).
- **Detail Headline:** the larger title role leads the full game page. At the mobile breakpoint it uses (2rem).
- **Title:** platform group headings use the title role, reducing to (1rem) on mobile. Dialog headings retain the base secondary-heading style (1.2rem); detail subsections use (1rem).
- **Body:** normal content and inherited controls use the root size. Library introduction and detail description copy use (0.9375rem), with detail descriptions at line-height (1.8) and a maximum measure (70ch).
- **Label:** gallery field labels use the label role. Connection labels use (13px). Supporting counts and navigation text use the compact rem-based scale and tabular numerals where appropriate.
- **Card Title:** gallery titles use the frontmatter card-title role, wrapping to at most two lines. Mobile large-cover titles use (0.8125rem), and compact-cover titles use (0.6875rem).

The root size follows Silo readability preferences: default (16px), large (18px) and extra large (20px). Strong text sets the inherited weight (550). High contrast promotes muted text and strengthens border separation. Approval codes alone use a monospace face.

**The Title First Rule.** In a game detail, the title precedes normal platform metadata. Platform information is not an uppercase kicker above the heading.

## Layout

The library is a full-width rail-and-content composition, not the older centered form-and-grid layout. A sticky, independently scrollable rail occupies (238px), narrowing to (210px) at the intermediate breakpoint (1000px). The content column can shrink without overflow, is capped at (1800px), and uses responsive horizontal gutters between (20px) and (48px). The initial viewport combines the searchable rail with a searchable platform overview.

Platform tiles use an auto-filling grid with a minimum column width (155px) and landscape artwork (4:3). Supported and other platforms form separate groups. Each tile places its name and raw ROM count below its illustration. Empty platforms are hidden by default, with a profile-scoped Show empty platforms preference that also governs navigation. The gallery changes the main region to search, sort and optional collection controls, followed by a playable filter, cover-size control, results status, cover grid and pagination.

Large covers use minimum columns (175px) and gaps (28px by 20px). Small covers use minimum columns (125px) and gaps (25px by 16px). Both use portrait frames (3:4), contain the full artwork without cropping, and put title, platform metadata and an available-version count outside the image. Gallery route state restores through browser navigation; density is a separate presentation preference.

The full detail page uses an artwork column between (180px) and (300px), with a flexible reading column. Artwork stays sticky on desktop. A back action precedes the page; title, platform, genres when available, ROM version picker when needed, play state, description, available facts and a file-information disclosure follow in reading order.

At (1000px), gallery search takes a full row and the detail artwork narrows. At (720px), the rail becomes a fixed navigation drawer opened from the header. It keeps the same platform search and library destinations, closes after choosing a destination, and exposes its expanded state. Content gutters tighten to (18px). Platform tiles and large covers use two columns; small covers use three. A mobile platform select supplements the drawer. Detail artwork centers above the reading column, with static positioning and a maximum width (230px).

The dedicated player uses a viewport-height flex column. Its control header wraps on narrow screens; the game stage takes the remaining space. Connection forms keep their own narrower content region rather than inheriting library rail geometry.

## Elevation & Depth

Tonal separation and thin boundaries provide most depth. Platform and game cards have no padded outer shell or resting shadow. Platform artwork has a subtle mixed neutral ground; game artwork fits inside its clipped cover while preserving the full image. Account, controller-choice and pause dialogs use a dark translucent backdrop. Transient notices carry the floating shadow (see the sidecar).

Hover lifts platform artwork and game covers slightly (3px), only without a reduced-motion preference. The current stylesheet uses a spring-shaped easing over (180ms) for platform artwork and a later cover override of (140ms ease) for game covers. These motions indicate an interactive target without moving its text.

**The Flat Control Rule.** Preserve tonal hover states and the visible focus outline; ordinary buttons do not need ornamental shadows.

## Shapes

Controls use compact rounded corners; rail items are slightly tighter. Covers, platform artwork and dialogs use progressively larger clipping radii from the frontmatter. Game covers are portrait and platform artwork is landscape. Borders belong to controls, separators and dialogs; artwork cards remain open compositions. These forms stay consistent across themes.

## Components

### Buttons

Direct, text-led actions use the shared control shape. Secondary buttons use the surface and border pair, with a raised-surface hover. Primary buttons use the inverse pair and stronger weight (650). The detail play action adds a minimum height (46px); browser sign-in spans its form and uses a minimum height (48px). Back and breadcrumb actions combine a small inline SVG with a quiet text button. Header, navigation and filter controls keep a minimum target height (44px), including mobile Menu and Account actions.

Disabled controls reduce opacity (0.55) and show a waiting cursor. Keyboard focus uses an outline (3px) with offset (4px); gallery card focus increases the offset to (5px).

### Inputs / Fields

Persistent labels accompany gallery filters and connection fields. Native inputs and selects use a thin border, surface ground and shared control radius. Platform searches instead sit inside their navigation or overview context, with an accessible name and inline search SVG. A controller can open a named choice dialog for select controls; its stacked options have a minimum target height (44px), neutral inversion and `aria-pressed` for the selected choice.

### Navigation

The family header identifies Silo and Games, with account access at the far side. The library rail provides Platforms, All games, Play in Silo, available collections and searchable platform links. Repeated rows align a small SVG or platform illustration, a wrapping name and a quiet count. A current destination uses raised neutral fill, stronger weight and `aria-current="page"`. Mobile reuses the rail as a drawer rather than replacing its content with a long desktop dropdown.

### Platform Tiles

Bundled RomM SVG platform illustrations sit contained inside landscape artwork areas. Names and counts stay outside the image. The same illustration identity appears in rail links, gallery headings and missing-cover treatments. Unknown platforms use the small generic inline game SVG. Preserve the actual hardware illustrations rather than substituting invented platform wordmarks or glyphs.

### Game Cards / Artwork Fallbacks

A game card combines a portrait cover, a two-line title, a muted platform line and an available-version count into one target. RomM metadata grouping defines the card identity; matching display titles alone do not combine games. Supported games show a small positive play SVG with an accessible label. Other cards omit that indicator; they do not accumulate negative badges.

The fallback is already behind the cover image, so missing or failed artwork reveals a deliberate platform illustration and cleaned game title. Large desktop fallbacks also include platform text; mobile large fallbacks omit that redundant platform line. Small-cover density shows only the platform illustration inside the artwork, preserving the title and platform below it. Title clamping preserves whole lines. The detail page uses the same fallback at a larger size. Original file information remains available in the detail disclosure.

### Full Game Detail

Details occupy the main content area and retain library navigation. The title comes before platform metadata. Available genres, release year, player count, developer and publisher use restrained text or label/value pairs. The description remains readable without an internal scroll box. The primary action is Play / Resume when supported; otherwise an explanatory browse-only state names the supported systems. A labeled ROM version select appears for metadata-linked siblings, identifies the preferred version saved in RomM and loads the selected ROM before launch. Switching versions preserves the gallery return state without changing the RomM preference. Launch progress remains next to the action.

### Dialogs / Connection

Account, controller-choice and pause dialogs retain a surface, border, larger corners and viewport-bounded scrolling. Each dialog is named from its heading, uses the text control “Close”, and restores focus to an available opener. Full game detail uses the page pattern above.

The connection screen leads with Sign in to RomM. Token and pairing-code fields sit inside a secondary native disclosure. Pending browser approval stays inline with a bordered code panel, external continuation link, polite status and Cancel. Confirmation identifies the verified RomM username.

### Status / Feedback

Result counts, loading states, empty results and errors sit near the content they describe. Empty states provide a next action. Progress status stays in the player header; global notices float near the viewport bottom. Errors add danger text or border treatment and keep a written explanation.

## Do's and Don'ts

### Do:

- **Do** use Silo's semantic color aliases and bundled Plus Jakarta Sans.
- **Do** use the bundled RomM platform illustrations consistently across navigation, overview and cover fallbacks.
- **Do** keep platform tiles landscape and game covers portrait, with readable titles below the artwork.
- **Do** keep the game title before platform metadata on the detail page.
- **Do** preserve explicit labels, semantic selected states and visible keyboard focus.
- **Do** keep the game stage dominant and progress text visible.

### Don't:

- **Don't** introduce a competing decorative palette or display face.
- **Don't** replace the illustrated title fallback with an oversized initial.
- **Don't** turn a game detail into an account-style modal.
- **Don't** promote platform metadata into an uppercase eyebrow.
- **Don't** communicate error, selection or pending progress through color alone.
