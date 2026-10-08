> Copied from the Featherbone Claude project into the repo on 2026-10-06. The
> UI refresh itself is merged (PR #124, `fresh_ui`). Paths below that mention
> `Documents/Featherbone` now correspond to `Documents/featherbone`.

# Featherbone UI refresh — status

Separate thread from the backend security/performance review docs in this
project. Tracks the "freshen the UI" work: make Featherbone look like
`Documents/ddom`, add dark mode, and act on John's screenshot feedback.

**John's direction (switched to Opus because the work was "circling"):**
stop patching symptoms one at a time — look closely at ddom's styling and
follow it everywhere (buttons, palette, nav, tabs, grids). ddom is the
reference; when in doubt, measure ddom and match it. After the big pass:
"Much, much closer"; after the nits in #28–30: "Looks like you got it."

## How to work on this (important for continuity)

- **Measure ddom, don't guess.** ddom runs on John's machine at
  `http://localhost:8081`. It calls `window.prompt()` for a display name
  on startup, which the built-in browser doesn't support — set
  `localStorage.cp_display_name` first, then reload. Pull computed styles
  with `javascript_tool`. Its CSS is `/home/john/Documents/ddom/public/css/app.css`.
- Featherbone runs at `http://localhost:3003/demo/` (NOT bare `/`, which
  errors with "Deserialize user function requires a tenant").
- Query strings on static files (`featherbone.css?v=…`) make John's dev
  server return an HTML 500 page — never cache-bust that way. To pick up a
  changed file: `await fetch('<path>', {cache: 'reload'})` then
  `location.reload()`.
- Real screenshots work when the pane is visible; to inspect small
  details, clone the elements into a fixed overlay with `zoom: 3` (the
  pane's own zoom action isn't supported).
- **When the Claude app window is covered, screenshots time out AND
  Mithril's async redraws stall** (requestAnimationFrame doesn't fire), so
  lists look empty after a fetch. Call `m.redraw.sync()` before measuring.
  For pictures, load html2canvas from cdnjs into the page and return the
  JPEG as base64 padded past ~80K chars, so the tool result spills to a
  file instead of into context; decode it in the sandbox and Read it.
  html2canvas misdraws sticky headers, range inputs and input text
  baselines — trust JS measurements for those.
- Don't toggle a workbook's edit mode casually: the Edit button saves the
  sheet profile. Child grids in forms are always in edit mode, so test
  inline editing there instead (click a row, then dispatch `mouseover` on
  the relation container to open its menu). To test a short visible area,
  force `.fb-child-table .fb-table-scroll { height: …px !important }` —
  `resize()` resets a plain inline height on every redraw.
- **App module code (Design, Plan, Make, Bill, …) lives in the database,
  not the repo** — fetched via POST `/demo/data/modules` and run with
  `new Function`. If something looks off only on certain module screens,
  grep the module scripts from that endpoint; fix centrally in core
  components where possible rather than editing module records.

## Delivery mechanism

- GitHub push to `FeatherboneJS/Featherbone` is blocked; **John: don't
  chase this, he'll circle back.** Don't retry pushes or raise it.
- Work in the cloud clone at `/home/claude/featherbone`, commit there, then
  write files straight into John's checkout `/home/john/Documents/Featherbone`
  with `device_commit_files` (needs a stagedPath under
  `/mnt/user-data/outputs/`).
- **Root cause of the "silent no-op" commits:** reusing the same
  stagedPath for a second commit re-sends the stale first copy (reported
  `written`, disk unchanged). Always copy to a fresh, unique staged path
  per commit (e.g. `/mnt/user-data/outputs/v/<timestamp>/…`). Still
  re-stage and byte-diff after every commit.
- Before overwriting, stage John's current copies and compare to the
  sandbox HEAD to make sure he hasn't edited them locally.
- `index_debug.html` loads unbundled source; `client/clientmin.js` is not
  regenerated — don't edit it.

## Done (cumulative, all delivered and byte-verified on John's disk)

1–13. Earlier rounds: tokens + dark mode, checkbox rewrite, colors →
   tokens, TinyMCE dark skin, 13px base type, Gantt → SVG, nav recolor,
   test/dev env banner, responsive toolbar overflow (`toolbar.js`).
14–21. An earlier round's piecemeal fixes — largely superseded by #22–27.
22. **Header truncation — actual root cause.** An earlier round added a
    global `* { box-sizing: border-box }`; upstream never had one. It made
    every grid cell's padding come out of its configured column width
    (~26px lost per column). Removed; grid cells are content-box again.
    No column-width calculation was needed.
23. **Grid rebuilt as one table in one scroll box** (`table-widget.js`),
    ddom's approach: sticky `thead`/`tfoot`; `table-layout: fixed` with
    widths from the header row plus a trailing filler column; fixed-width
    leading status column; edit rows the same height as view rows;
    deleted rows a styled `tr` instead of `<del><tr>`.
24. **ddom palette and type**: ddom's exact light/dark tokens (Google-blue
    accent), system font stack everywhere incl. over Pure's grid font.
25. **Every `.pure-button` is ddom's button**: surface, 1px border, 4px
    radius, no shadow, text-colored 16px icons, 30px tall like inputs.
    Primary = blue fill, danger = red outline. Labels in their own span.
26. **Toolbars**: flex rows, even spacing, filler before right-hand groups;
    ddom search field; form actions in the form's own order; overflow menu
    collapses from the end and labels icon-only items.
27. **Nav and tabs**: nav 220px, 15px bold title, 14px items; form tabs and
    worksheet tabs share ddom's tab (sheet tabs flipped under the grid);
    relation labels look like labels until hovered; form page is a surface
    sheet; ddom-style dropdown menus and dialogs.
28. **Nits after "much, much closer"**: dropdown trigger buttons had their
    glyphs pinned to the top of the button (the button is also the
    `.material-icons(-outlined)` element and that rule's `display:
    inline-block; line-height: 1` won on source order) — fixed with a
    two-class rule restoring flex centering. Relation label icon set to
    `vertical-align: -3px`. Grid edit cells `overflow: visible` again —
    clipping had hidden the inline relation editor's menu.
29. **Grid relation menu cut off on the first row**
    (`relation-widget.js` `positionMenu()`): it flipped the menu upward
    whenever it ran past the bottom of the tbody — which was the scroll
    box in the old grid but is just the rows now, so on a short list the
    first row's menu flipped up behind the sticky header and Search was
    hidden. Now measured against the grid's scroll box, opens upward only
    when there's room above the row (below the header), and sits flush
    against its button (a gap let mouseout close it on the way over).
    Verified: first and last rows open below; a row near the bottom of a
    short visible area opens upward; all items clickable in each case.
30. **White buttons in dark mode** (Work Order Hierarchy tab, Product Bill
    of Material widgets): the Design, Plan, Make and Bill modules create
    17 `Button` view models with `style: {backgroundColor: "white"}`
    (copied from core's old child-table buttons). Fixed centrally in
    `button.js` (`buttonStyle()` drops a plain white background, passes
    any other inline style through) — no module edits. Also
    `.pure-button + .pure-button { margin-left: 6px }` so plain button
    rows are spaced like ddom, reset to 0 inside flex toolbars/tabs/dialogs
    that already use `gap`. Verified in dark mode on both screens.

## Open / possible follow-ups

- Worksheet tabs are still at the bottom (Excel-style) — ddom's are at the
  top. Small layout change if John wants it.
- Home page right-hand order is account, workbook menu, global settings
  (was account, global settings, workbook menu) — trivial to swap.
- At narrower widths the aligned form wraps labels above inputs
  (pre-existing Pure behavior).
- CodeMirror has no dark theme yet.

## Sandbox state

`/home/claude/featherbone`, branch `ui-refresh-4`, tip `b2fa70d2` ("Drop
hard-coded white button backgrounds; space plain button rows") on top of
`9bddaa45`, `a3c05fd3` and `432cb0c7` ("Follow ddom's styling throughout")
and earlier round commits on upstream `master` `867c1463`. Never pushed
(see above). (Update 2026-10-06: the work reached GitHub via PR #124,
`fresh_ui`, merged 2026-09-28.)
