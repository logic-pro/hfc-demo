# PM Board (PM-owned · single writer)

**Trunk:** `origin/main = 77b5887` (green). **Round:** corporate dashboard integration.
**Merge order:** ✅ slice-c(#1) · ✅ CI · ✅ alpha(#2) · ✅ smoke-fix → **bravo(#3)** → charlie(#4) → D-NPS-SWAP → echo/slice-d(#5).

| Slot | Branch | State | PR / CI | Next action |
|---|---|---|---|---|
| alpha | alpha | ✅ merged (#2) | PR #3 merged | retire |
| bravo | bravo | 🔄 active | needs rebase + EF swap → PR | merge #3 (EF swap now unblocked) |
| charlie | charlie | ⏸ rebased+grafted, holding | no PR yet | flip D17 live after bravo → PR #4 |
| delta (←slice-a/CI) | chore/ci-green-gate | 🟢 FREE | CI PR #4 merged | **awaiting PM assignment** |
| echo (←slice-d) | slice-d-franchisee-dashboard | ⏸ holding for charlie | no PR yet | rebase into charlie's shell → PR #5 |
| wt-modularize | chore/modularize-endpoints | ⏸ holds until round-1 done | — | refactor hub files, then PR |

**Retired:** slice-b (PR #1), slice-c (PR #2).
**Gate reminder:** CI green on the PR is the merge authority — not self-reports.
