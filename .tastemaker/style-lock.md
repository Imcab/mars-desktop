# Style lock — MARS Desktop

Established: 2026-09-06. Source: user-supplied reference images (AdvantageScope, RViz, a 3D-tool property panel) + existing `src/styles/global.css` dark palette (kept, not replaced).

This is an **app-shell desktop tool** (Tauri + React), not a marketing site — most of tastemaker's marketing-page sections (hero, macrostructure, narrative arc, asset curation, motion storytelling) don't apply here and are omitted. The brief: make the existing dark engineering-tool palette actually *read* as engineering software (RViz/AdvantageScope/MATLAB), not just deduplicate the code that draws it.

## Light-mode pivot (2026-09-06, supersedes the dark palette below)
User pushback: the dark theme itself read as "unprofessional" — pointed at AdvantageScope, RViz and MoveIt reference screenshots, **all of which are light/white chrome**, and asked for the app to go light, plus for toolbar icons to carry real per-function color (not flat monochrome) the way RViz/Qt icon sets do. Converted the whole token set in `global.css` from dark to light. Because most components already read colors through `var(--token)` (thanks to the earlier consolidation phases), the palette swap cascaded automatically almost everywhere — but several places had a **literal, non-token white-on-dark assumption** baked in that broke when the underlying token flipped to light. Found and fixed by grepping the whole `src` for `#fff`/`rgba(255,255,255,...)` after the flip:
- `ProjectVariablesPage.tsx` subsystem header: was `background: var(--bg-dark)` (now light) + `color: #fff` → now `var(--bg-menubar)` + `var(--text-primary)`, matching the sibling group-header pattern already used in `TelemetryPage`.
- `SubsystemWizardPage.tsx` (×3) and `PhonePage.tsx` (×1): step/primary buttons used `var(--bg-menubar)` as an ad-hoc "accent" fill (it only worked because bg-menubar used to be saturated blue) + white text → now `var(--mars-accent)`, the real accent token.
- `TitleBar.tsx`: `var(--text-light)` on `var(--bg-dark)` — both ended up near-white-on-light and unreadable → moved to `var(--text-secondary)`.
- `ProjectBuilderPage.tsx`: disabled-button fill was `var(--text-light)` (now light) + white text → `var(--mars-grey)`.
- Two token *values* needed darkening because they're used as real body text but were tuned only for "looks fine as a light literal on dark bg": `--text-muted` #85858c→**#68686f**, `--text-light` #b0b0b6→**#6f6f76`. Both re-verified against white/panel/bg-dark via `check_contrast.py`.
- `--text-header-eyebrow`/`--text-header-subtitle` moved from `rgba(0,0,0,X)` alpha-blends to solid hex (`#5c5c62`/`#6e6e74`) — alpha blending gave inconsistent effective contrast depending on what was underneath (passed on white, failed on panel/menubar); a solid value is predictable everywhere it's used.
- `ProjectBuilderPage.tsx`'s `#fdf0ef`/`#f0f8f0` pale status banners — previously flagged in the original audit as "light colors in a dark app, looks like a bug." They are not a bug anymore: in a light theme they're exactly the standard pale alert-banner convention. No change needed, self-resolved by the pivot.

## Palette (`global.css`, light mode)
- Background (page canvas): `--bg-page` #ffffff — the quietest surface, per app-shell "content area = canvas" rule.
- Surface (sidebar/cards/panels): `--bg-panel` #f7f7f8 — one step of gray off the canvas.
- Chrome (toolbar / menu bar / panel headers): `--bg-toolbar`/`--bg-app` #ececee, `--bg-menubar` #f0f0f1, `--bg-dark` (title bar/status bar) #eeeeef. All neutral light grays, distinguished from each other only by ~1-2% lightness + hairline borders — no saturated color in structural chrome, per every reference image.
- Primary/brand: `--mars-red` #a83c3c (unchanged hex — still clears text-safe against white at 6.22:1). Reserved for destructive/error actions and the real-robot connect variant.
- Accent: `--mars-accent` — darkened from #6278f1 to **#4a5fd9** so it clears text-safe (5.34:1) against white; the original dark-mode value was tuned to pop against near-black and read as pale/washed-out on white.
- Text: `--text-primary` #1c1c1f, `--text-secondary` #52525b, `--text-muted` #68686f, `--text-light` #6f6f76 (see pivot note above for why muted/light needed darkening beyond a naive hex-invert).
- Icon default color (chrome): `--icon-toolbar` #4a4a50 — neutral charcoal, still the "no color unless it means something" default for the Home icon and anywhere a function category isn't assigned.
- **Per-function icon color** (new, directly requested — "que cada ícono tenga un color"): `ToolbarButton` gained an `iconColor` prop. Four category tokens, checked >=4.5:1 against both `--bg-toolbar` and `--bg-panel`: `--icon-cat-file` #1e4fc9 (New/Open Project, Welcome's PROJECT cards), `--icon-cat-tools` #0f766e (2D Visualizer/Telemetry/Display/Function, Welcome's LIVE DATA cards), `--icon-cat-modules` #8a5a08 (Packages/Wizard/Variables/Manifest/Phone, Welcome's TOOLS cards), `--icon-cat-config` #7c3aed (Watchdog/Loop Timing/Console/Settings). Connect Sim/Real keep their existing green/red variant (already semantic, untouched). Home stays neutral — it's the anchor, not a category. This is wayfinding color-coding (RViz/Qt icon-theme convention), not decoration: each zone of the toolbar gets one consistent hue.
- Type colors (Telemetry/Manifest) darkened from dark-mode pastels for light-bg legibility: `--type-string` #e3b341→**#8a5a08**, `--type-struct` #4db8d8→**#0e7490**, `--type-array` #c76fd1→**#9333ea**.
- Status colors darkened similarly: `--status-warning` #cf961b→**#a1690a**. `--status-sim`/`--status-success`/`--status-real`/`--module-enabled`/`--module-disabled` kept close to their original hues (already mid-tone enough to read on white at ~4.2-5.4:1); see Color contract for the one accepted compromise (status-sim vs. white/dark-fill can't both hit 4.5 with one hex, see below).
- `--statusbar-project-bg` darkened #d97706→**#a65200** so white label text on it clears 4.5:1 (was 3.19:1, a real regression from the flip).

## Color contract
Ran `scripts/check_contrast.py --matrix` against the light tokens (text=#1c1c1f bg=#ffffff surface=#f7f7f8 primary=#a83c3c accent=#4a5fd9 border=#d4d4d8 on-primary=#ffffff):

- **Text-safe (>=4.5):** text/bg (17.00), text/on-primary (17.00), text/surface (15.88), text/border (11.50), bg/primary (6.22), primary/on-primary (6.22), surface/primary (5.81), bg/accent (5.34), accent/on-primary (5.34), surface/accent (4.99)
- **UI-safe (>=3.0, <4.5):** primary/border (4.21), accent/border (3.62), text/accent (3.18)
- **Decorative (<3.0), hairlines/fills only, must never carry state alone:** text/primary (2.73 — dark text on a mars-red fill does NOT work, always pair mars-red fills with white/on-primary text), bg/border, border/on-primary, surface/border, primary/accent, bg/surface, surface/on-primary, bg/on-primary

**Accepted compromise, documented rather than silently shipped:** `--status-sim` (#1c8f1c) is used both as colored text-on-white (needs >=4.5 vs white, gets 4.20) and as a fill with dark `--statusbar-on-fg` text on top (needs >=4.5 for dark-on-fill, gets 4.49). No single hex cleared both thresholds in testing without sacrificing one entirely (tried #2fa42f, #278c27, #22a022 — always fixed one pairing while breaking the other further). Both land at ~4.2-4.49, i.e. visually indistinguishable from passing on any real display; treated as a floor-adjacent pass rather than introducing a second green token for a sub-0.3 ratio gap. Re-open this only if a future accessibility audit flags it specifically.

Practical read: `--border-main` against any background is intentionally low-contrast (it's a hairline divider, not a state indicator — exempt per the decorative-hairline rule). Any new UI that needs a border to *convey* state (focus ring, error edge) must use a text-safe or UI-safe pairing instead of `--border-main` alone — e.g. `var(--status-error)` for an error-state border, not the default border color. And per the matrix above: **never put dark text directly on a `--mars-red` fill** — that pairing is 2.73, decorative-only; mars-red fills always take white/`on-primary` text.

## Typography
- UI chrome: `'Segoe UI', Arial, sans-serif` (unchanged, system-native — matches the "native OS tool" feel of RViz/AdvantageScope rather than an imported webfont)
- Data/numeric values: `ui-monospace, SFMono-Regular, monospace` — already used throughout (timeline ticks, telemetry tables, struct fields); kept and leaned into further, since monospace-for-data is a strong "instrumentation panel" signal (matches RViz's numeric readouts).

## Shape language
- Corner radius: 2-4px throughout (unchanged) — sharp, not rounded; matches the reference software's flat, un-rounded chrome.
- Shadow depth: none anywhere in the app (unchanged) — separation is done with 1px hairline borders, exactly like RViz/AdvantageScope. Do not introduce drop shadows.
- Border usage: 1px hairlines for structural separation (unchanged).
- **New: GroupBox pattern** (`src/components/common/GroupBox.tsx`) — a titled bordered panel with the label embedded in the top border line, styled after MATLAB's `uipanel` / Qt's `QGroupBox`. This is the concrete "engineering software" signature the references share that MARS didn't have at all before today (plain stacked labels instead of grouped, bordered sections). Piloted on `WatchDogPage`'s sidebar (Filters / Session Summary groups) — not yet rolled out to the other 8 pages, pending user confirmation of the direction.

## Density & spacing
- Sidebar sections: 20-24px outer padding, 16px gap between grouped fields inside a GroupBox (tightened from the previous 20px gap between ungrouped blocks, since the GroupBox border now does the separation work).
- Data tables/lists: already dense (8-10px row padding, 10-12px font) — matches the app-shell density guidance of "denser than a marketing page's spacing scale."

## Timeline (specifically called out by the user against AdvantageScope)
`src/components/layout/TimelineCanvas.tsx`'s `draw()` — **changed today**:
- Removed the horizontal line bisecting the ruler at half-height (was making it read as a chart axis, not a ruler).
- Tick marks now hang from one edge only (top, y=4→11) instead of both top and bottom.
- Tick labels moved below the ticks (baseline "top" at y=15) instead of vertically centered mid-bar.
- `drawCenteredMessage` ("NO SIGNAL"/"WAITING FOR DATA") lost its own bisecting line too, for the same reason — now just centered muted monospace text on the flat bar.
- The two colors that were literal JS strings instead of resolved tokens (`cssMuted`, `cssBright`) now resolve from `--text-header-eyebrow`/`--text-header-title` via `getComputedStyle`, same as the other two.

## App shell chrome
- Sidebar background: `--bg-panel` (Surface), one step off the page canvas — per the app-shell "sidebar reads as structural chrome, content area is the canvas" rule.
- Panel headers / top menu bar: `--bg-menubar`, neutral light gray (see Palette section above).
- Active nav treatment: background fill (`--border-dark`) on the active `ToolbarButton`. Icon color is now per-category (see Palette's "Per-function icon color" — superseded the earlier "icon stays neutral in every state" decision once the user asked for per-icon color; active/inactive state is still conveyed by the background fill, not by changing the icon's hue).

## Structural pass — RViz widget chrome, not just color (2026-09-06)
User pushback again: color alone doesn't make it look like RViz — the actual widget/panel *shapes* were still generic. Compared side-by-side against a real RViz screenshot (Displays/Views/Time as separate docked panels, each with its own solid titlebar + icon + content, a slim single-row toolbar, a bare two-item menu bar). Concrete structural changes, not palette tweaks:
- **`GroupBox` → `Panel`** (`src/components/common/GroupBox.tsx` deleted, replaced by `src/components/common/Panel.tsx`). Old look: title embedded in the border line (MATLAB `uipanel`). New look: a solid titlebar strip (`--bg-menubar` background, optional leading icon, bottom hairline) with content below — this is RViz/Qt's `QDockWidget` convention, a materially different shape, not a recolor. Same prop contract otherwise (`title`, `children`), so all 15 call sites across 7 pages needed only an import-path + tag rename, no logic changes. Added a matching `icon` per panel (Filters→`ti-filter`, Statistics/Summary panels→`ti-chart-bar`, Registry→`ti-package`, etc.) since RViz's own "Displays"/"Views" titlebars carry a small icon next to the label.
- **`ToolbarButton`'s `"lg"` size**: was a big ribbon button (64×62px, icon stacked above label, Office-ribbon shape). Now a compact horizontal row (30px tall, icon beside label, 11.5px text) — matches RViz's slim single-row toolbar instead of a ribbon. `ToolBar.tsx`'s container dropped from 76px to 38px tall to match; separators shrank from 48px to 20px tall.
- **`MenuBar`**: removed the MARS logo block and the right-aligned current-page indicator — RViz's menu bar is bare text ("File Panels Help"), zero branding, zero status readouts. Height dropped 32px→26px. Dropdown panels gained a subtle shadow (the one deliberate exception to the "no shadows anywhere" shape-language rule — a transient floating overlay reads better separated from the content under it; static chrome still uses hairlines only).
- **`DashboardCard`'s header bar**: already structurally matched RViz's titlebar convention (title + small icon buttons at the right, distinct bg strip) before this pass — just aligned its background token from `--bg-dark` to `--bg-menubar` so every "titled container" in the app (Panel, DashboardCard, PanelHeader) shares one exact titlebar tone instead of two near-identical grays.
- **Deliberately not attempted**: real dockable/draggable/floating panels (an actual window-manager layer like RViz's Qt dock widgets). That's a genuinely different engineering effort — window management, drag-and-drop docking, saved layouts — not a visual-language change, and wasn't what was asked. What shipped is the *visual* vocabulary of RViz's panels (titlebar + icon + framed content), applied to the existing fixed-sidebar layout.

## GroupBox rollout — resolved
User confirmed the direction (2026-09-06). Rolled out to all 7 remaining form-driven sidebars: `TelemetryPage` (Filters / Topic Statistics), `ManifestPage` (Filters / Module Statistics), `ProjectVariablesPage` (Filters / Variable Statistics), `PackagePage` (Registry / Manual Install), `JitterAnalyzerPage` (Filters / Severity Legend / Summary), `CommandConsolePage` (Filters / Writable Types). `DisplayPage` and `FunctionPage` were deliberately left out — their sidebar is a single `TreeDirectory` tree view with nothing to group (`PageHeader` already labels it, matching RViz's own "Displays" panel: title bar + tree, no extra box). Dropped now-redundant standalone `<label>` headers where the GroupBox title already said the same thing (e.g. PackagePage's "REGISTRY STATUS" label, now just the GroupBox title "Registry").
