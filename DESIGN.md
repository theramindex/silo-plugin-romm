---
name: RomM for Silo
description: A functional games library within the Silo plugin family.
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
    fontSize: "clamp(30px, 4vw, 44px)"
    fontWeight: 700
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
  label:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  card-title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.4
rounded:
  control: "8px"
  cover: "10px"
  container: "12px"
  dialog: "16px"
spacing:
  compact: "8px"
  control-y: "10px"
  control-x: "15px"
  field: "12px"
  group: "16px"
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
    padding: "12px"
  cover:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.cover}"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "32px"
---

# Design System: RomM for Silo

## Overview

**Creative North Star: "The Silo Library"**

RomM uses the existing Silo plugin family's operational visual language. The
interface is quiet, compact and content-led: game covers and titles supply its
identity, while the surrounding controls remain familiar across the library,
account forms and player.

Dark and light surfaces share the same geometry. Clear labels, visible focus
and explicit state text support touch, keyboard and controller use. The player
retains this control language while giving the game the remaining viewport.

**Key Characteristics:**
- Semantic Silo colors with coherent dark and light fallbacks.
- One bundled type family for headings, content and controls.
- Cover-led grids and compact, labeled fields.
- Neutral selected controls, named dialogs and explicit progress status.

## Colors

The palette uses Silo's semantic custom properties rather than a separate game
brand palette. The frontmatter references the resolved aliases in the shipped
stylesheet; their values change together with the active theme.

### Primary

- **Primary / On Primary:** an inverse pair for the principal action. The default
  dark theme uses a pale action surface; the light theme uses a dark one.
- **Danger:** reserved for disconnect actions and error text or borders.

### Neutral

- **Background:** the page ground.
- **Navigation:** a separate tonal ground for the application header.
- **Surface / Surface Raised:** fields, buttons, dialogs, empty cover areas and
  transient notices.
- **Border:** subtle separators and control boundaries.
- **Text / Muted Text:** main content and supporting metadata respectively.

**The Theme Alias Rule.** Reuse the existing semantic aliases so foreground,
background and borders change as a coherent theme.

**The Inverted Selection Rule.** A selected controller choice uses the text
color as its background and the surface color as its foreground. Selection is
also expressed through `aria-pressed`.

## Typography

**Display Font:** Plus Jakarta Sans, with the UI sans-serif fallback stack.
**Body Font:** the same bundled family; no competing display face.

**Character:** compact sans-serif typography keeps covers prominent and labels
legible. Weight and restrained negative heading tracking establish hierarchy;
metadata uses quieter color rather than another type family.

### Hierarchy

- **Headline:** responsive page headings, using the frontmatter headline role.
- **Title:** dialog and game-detail headings, using the title role.
- **Body:** normal content and inherited control text. Longer descriptions use
  a generous line-height (1.65), and help copy uses line-height (1.7).
- **Label:** labeled form controls use the label role. Supporting metadata is
  generally smaller and muted.
- **Card Title:** compact, wrapping game titles. Mobile cards reduce this role
  to the observed compact size (12px).

The root size follows Silo readability preferences: default (16px), large
(18px) and extra large (20px). Strong text sets the inherited weight (550).
High contrast promotes muted text and strengthens border separation.

**The Title First Rule.** In a game detail, the title precedes normal platform
metadata. Platform information is not an uppercase kicker above the heading.

## Layout

The library uses a centered content region capped at (1600px), with desktop
page padding from the section spacing. Search takes the flexible part of a
horizontal filter row; platform and collection fields remain clearly labeled.

The cover grid fills available width using columns with a minimum width
(165px). Portrait covers keep a (3:4) aspect ratio. Titles and metadata sit
below the artwork without another padded card shell.

At the compact breakpoint (720px), header and page gutters tighten, search
occupies its own row, and the other filters share the following row. The grid
uses three equal columns, reducing to two below the narrow breakpoint (400px).
Game details collapse from an artwork-and-description split to a single column.

The dedicated player uses a viewport-height flex column. Its control header can
wrap on narrow screens; the game stage takes the remaining space without
forcing page scrolling.

## Elevation & Depth

Tonal separation and thin borders provide most depth. Cards and ordinary
controls remain flat. Dialogs separate from the page through a dark translucent
backdrop, while notices use the sole floating shadow treatment. Cover hover
motion is a small lift (3px) over (140ms ease), enabled only when reduced motion
is not requested.

**The Flat Control Rule.** Preserve tonal hover states and the visible focus
outline; ordinary buttons do not need ornamental shadows.

## Shapes

Controls use the compact rounded shape; covers and notices share the cover
radius. Empty-state containers and dialogs use progressively larger corners.
Portrait art is clipped within a thin border. These forms stay consistent
across themes instead of changing to a different material treatment.

## Components

### Buttons

Buttons are direct, text-led actions. Secondary actions use the surface and
border pair; primary actions use the inverse primary pair and a stronger
weight (650). Hover moves secondary buttons to the raised surface. Disabled
controls reduce opacity (0.55) and show a waiting cursor.

Keyboard focus uses an explicit outline (3px) with an offset (4px). Cover-card
focus has a larger offset (7px) so the whole artwork-and-title target remains
clear.

### Inputs / Fields

Fields use the surface background, thin border and shared control radius. A
label sits above each field; placeholder text supplements that label. The
controller can open a named choice dialog for native select controls. Its
vertically stacked options use a minimum target height (44px).

### Cards / Containers

A game card is an interactive cover, title and muted platform line. Missing
art keeps the same portrait geometry with a muted initial. Text can wrap
without expanding the grid column. Empty results use a bordered container and
a short, actionable message.

### Navigation

The compact header identifies Silo and Games, with account access separated to
the far side. It retains the same tonal ground and controls on smaller screens.
The player replaces library navigation with pause, save and exit actions plus
an explicit sync-status line.

### Dialogs

Dialogs use a surface, thin border, generous padding and scrolling within the
viewport. Each dialog is named from its heading. The close control uses the
word “Close”; closing returns focus to its available opener. Game details,
account controls, controller choices and pause actions share this container.

### Status / Feedback

Supporting state text remains adjacent to its context. Progress status stays
in the player header; global notices float near the viewport bottom. Errors
add the danger border or text treatment without replacing their explanation
with color alone.

## Do's and Don'ts

### Do:

- **Do** use Silo's semantic color aliases and its bundled font family.
- **Do** keep covers portrait, titles wrapping and metadata below the title.
- **Do** preserve explicit labels, named dialogs and visible keyboard focus.
- **Do** use neutral inversion together with a semantic selected state.
- **Do** keep the game stage dominant and progress text visible.

### Don't:

- **Don't** introduce a competing decorative palette or display face.
- **Don't** use a glyph in place of the established text close control.
- **Don't** promote platform metadata into an uppercase eyebrow.
- **Don't** communicate error, selection or pending progress through color alone.
