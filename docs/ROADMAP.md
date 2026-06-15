# HFC Demo — Roadmap (parked until the demo is steady)

Captured so nothing's lost. **Decision rule:** finish what's in flight → stabilize → *then*
decide which of these to build. Sequenced credibility-first (every number stays defensible —
features that *generate* numbers must carry a `provenance: derived/forecast` label).

## Committed / in-flight (not on this list)
- 4-tier RBAC (network→brand→region→territory) — finishing now
- Hardening: ProblemDetails (no stack traces), input validation, security headers, a11y, mobile table
- **Light/dark theme toggle** — APPROVED, queued for after the in-flight round (see charlie phase 3)

## Tier 1 — credibility first (highest CEO value, buildable on the current read model)
1. **Financial reporting ingestion** — royalty upload (CSV / accounting export) that flips the
   financial sub-score from *seeded → measured*. Closes the "8/24 pending" gap. The single most
   credible feature; everything financial depends on it.
2. **Watchlist → intervention loop (D15)** — open → in-progress → resolved, with owner + SLA.
   Turns passive flags into an ops command view. Watchlist flags already exist; this is an extension.
3. **Peer benchmarking** — anonymized percentiles by brand tier / tenure ("bottom 25% of mature
   Budget Blinds territories"). Pure network-economics lever; builds on per-territory scores.
4. **Board-ready export** — one-click PDF/deck of the current scope's vital signs + watchlist +
   map, with a CEO commentary field. Low risk, used every board meeting.

## Tier 2 — needs real data first (label as derived/forecast)
5. **Royalty collection forecast (30/60/90)** — depends on #1 (real royalty data).
6. **Predictive territory risk** — "on a path to At-Risk by August" from trend data. Needs history.
7. **Mobile executive digest** — daily push (Twilio/SendGrid, already in the stack) of overnight alerts.
8. **NL query** — navigation-only ("show at-risk Budget Blinds"), NOT number-computation (hallucination risk).

## Tier 3 — sharper franchisor differentiators (my additions)
9. **Unit-economics & expansion** — "which markets are underpenetrated / which strong territories
   are ripe for a 2nd unit." Franchisors earn on royalties *and* selling units — nobody does this well.
10. **Cohort / tenure view** — performance by months-since-open; tells the CEO if the *onboarding
    system* scales, not just individual operators.

## Framing for the interview
Map any built feature to the four franchisor-CEO decisions: where to **invest**, who to **coach/cut**,
where network economics **leak**, royalty/unit-economics **health**. Pitch: *"First we make every
number real and give you somewhere to act — then we make it predict. In that order, so you can trust it."*
