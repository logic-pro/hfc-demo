# Status: chore-modularize
_Updated 2026-06-17T03-30-24Z (branch feat/backoffice-shell)_

chore-modularize — DONE (PR #48, awaiting CI).

FOUNDATION lane delivered: back-office shell + routing + ComingSoon + admin/feature stubs.

Contract C1 FROZEN (feature lanes branch off this):
- Route subtree: /back-office (corporateGuard) → shell parent + lazy children:
    ''               → BackOfficeHomeComponent      backoffice/home/back-office-home.component.ts
    reports          → ReportBuilderComponent       backoffice/reports/report-builder.component.ts   [STUB]
    territories      → TerritoryExplorerComponent   backoffice/territories/territory-explorer.component.ts   [STUB]
    territories/:id  → TerritoryScorecardComponent  backoffice/territories/territory-scorecard.component.ts  [STUB]
    admin/users      → UsersRolesComponent          backoffice/admin/users-roles.component.ts
    admin/catalog    → OrgCatalogComponent          backoffice/admin/org-catalog.component.ts
- Reusable placeholder: <bo-coming-soon> (ComingSoonComponent) at backoffice/shared/coming-soon.component.ts
- Nav entry "Back office" added in app-shell.ts, gated on tenant.isCorporate().

HANDOFF to charlie (reports) + bravo (territories): overwrite the 3 [STUB] files in place — same path/export/selector. Do NOT touch app.routes.ts (routing is written once). Import <bo-coming-soon> from backoffice/shared for any not-yet-built panels.

Gate: ng build --configuration development = GREEN (each section its own lazy chunk; all routes resolve; franchisee bounced by corporateGuard). All design-token styling, no raw hex.
Scope: only app.routes.ts, app-shell.ts, backoffice/** (allowed_paths). .claude/settings.json left unstaged.
Note: CI prettier step is non-blocking (continue-on-error) and pre-existing tree already drifts; files follow repo hand-format style.

Blocking: none. Ready to merge on CI green — this PR gates bravo + charlie.
