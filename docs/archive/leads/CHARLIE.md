# Lead Prompt — Worktree CHARLIE · Angular Dashboard UI (THE SHOWCASE)

You are the lead for the **charlie** worktree. **You are the jaw-drop.** This dashboard
is what the panel actually *sees* — it has to look like a bespoke executive product,
not a tutorial. Your north star: *"a franchise CEO would put this on the boardroom
screen."* Generic Material/Bootstrap slop is a failure condition.

## Read first
1. `docs/dashboard/CONTRACT.md` — **your API DTOs are §2.** Copy them verbatim into fixtures and build now; don't wait for Bravo.
2. `docs/dashboard/BACKLOG.md` — your issues: **D11–D18** (most are `wow`).
3. `docs/tech/angular.md` — standalone components, signals, RxJS, control flow (the stack you're matching; ADR).
4. `web/src/app/` — existing Angular 20 app (api.service.ts, models.ts, app.* ) to extend.

## Invoke these skills
`frontend-bi-dashboard-architect` (your PRIMARY — Angular + Tailwind dashboards as
decision interfaces: component architecture, view-model contracts, states, dataviz)
and `franchise-ceo-dashboard-strategist` (hero-8, drill path, anti-vanity — keeps the
*content* executive-grade while you make the *form* stunning).

---

## DESIGN IDENTITY — non-negotiable, this is what makes it unique

Build a deliberate visual language. Pick **one** cohesive direction and commit hard
— do not mix. Recommended: **"Operations Command Center."**

- **Theme:** dark, high-contrast executive surface. Deep slate/near-black canvas
  (`#0B0F1A`-ish), elevated cards with subtle inner glow, one decisive accent that
  encodes health (a cyan/emerald→amber→red scale). Brands get accent chips, not whole themes.
- **Typography:** a real type pairing — a tight geometric/grotesk for numbers
  (tabular figures, big confident KPI values) + a quieter UI sans for labels. Numbers
  are the hero; set them large with tabular alignment.
- **Motion:** purposeful, not decorative — KPI values **count up** on load,
  sparklines **draw in**, the map **settles** with a quick stagger, drill transitions
  **slide/scale** between portfolio→brand→territory. Keep it ~200–400ms, eased.
- **Data-ink:** every pixel earns its place. No drop-shadow soup, no rainbow charts.
  Color means health; gray means neutral; the accent means "look here."
- **Signature touches (pick 2+ to make it unforgettable):** an animated **radial
  health gauge** on the scorecard; a **choropleth/dot map** that pulses at-risk
  territories; a measured-vs-reported **provenance toggle** that visibly re-skins
  tiles; a watchlist that feels like a live ops queue.

If you reach for a component library, theme it past recognition (or use a headless
lib + your own styles). The grader should not be able to name the framework.

---

## WOW PRIORITY ORDER (build for impact, top-down)
1. **D11 — Executive theme + animated hero-8 tiles.** The first 3 seconds. Nail this first.
2. **D12 — Geographic territory health map.** The single most impressive element.
   Dots/regions shaded by composite score, at-risk pulsing, brand filter, hover mini-card.
   (Use a lightweight map/charting lib; if full geo is fiddly, a stylized US dot-map
   over seeded lat/long still lands — don't let perfect block the wow.)
3. **D14 — Territory scorecard with radial gauge** + 4 sub-score bars + ± drivers.
   The "explainable score" reveal that proves it's not a black box.
4. **D13 — Distribution histogram + ranked brand table**, click-to-drill.
5. **D16 — Provenance/data-quality visual** (measured vs reported/seeded). This is the
   honesty story that turns the data gap into a feature — make it a *feature*, not fine print.
6. **D15 — Watchlist action queue.**
7. **D17 — drill transitions + swap fixtures→live Bravo endpoints.**

## Definition of done
- Loads to a hero view that makes someone say "wait, you built that?" in <5s.
- Full drill works: portfolio → brand → territory scorecard, with smooth transitions.
- Every financial tile is visibly badged measured/reported/seeded with an as-of date —
  the provenance story is *shown*, not buried.
- Runs against live Bravo endpoints (fixtures only as fallback). A screenshot + the
  smoke path work, like the rest of the demo.
- It looks like *one* designed product, not assembled widgets.

## Coordination
- **Start now** against CONTRACT §2 fixtures — zero dependency on Alpha/Bravo to begin.
- Need a field shaped differently? Negotiate it into CONTRACT (edit + bump + ping
  bravo), don't fork the shape.
- Cross-domain OK: if you're ahead, you can help Bravo shape DTOs or seed flavor with Alpha.
- Note: this supersedes the older `slice-d-franchisee-dashboard` worktree — pull any
  useful bits, but charlie is the real dashboard now.

Close sessions with: **Recommended next step / Biggest risk / Architecture decision /
Skill to study next.**
