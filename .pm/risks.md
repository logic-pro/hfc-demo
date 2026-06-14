# Risks (PM-owned)

| ID | Risk | Severity | Status | Mitigation |
|---|---|---|---|---|
| R1 | Dashboard dir collision (exec-ui vs franchisee both want web/src/app/dashboard/) | High | Open (see decisions O1) | Split: franchisee → web/src/app/franchisee/ before echo rebases |
| R2 | Tailwind v4 global @import bleeds into /booking + /corporate | Med | Open | echo scopes the import to its layer; verify /booking + /corporate after |
| R3 | wt-modularize collides with round-1 hub-file edits if run early | High | Mitigated | Holds until bravo/charlie/echo land |
| R4 | Program.cs is a 4-lane chokepoint → serialized merges | Med | Mitigated now / cured later | Single-writer merge order now; wt-modularize removes the chokepoint for round 2 |
| R5 | CI actions (checkout/setup-* @v4) deprecate 2026-06-16 | Low | Open | Bump to @v5 when available (non-blocking) |
| R6 | /api/franchisees now returns 38 (dashboard franchisees in booking picker) | Low | Open (decisions O2) | Decide: filter to operational-only or accept |
