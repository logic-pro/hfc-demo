namespace HfcDemo;

// ── D1 seed — the believable, deliberately dramatic demo world ───────────────
// Seeds the data SPINE on main's two-axis tenancy (franchisee = isolation key,
// brand = grouping):
//   • Dashboard plane  → all 8 catalog brands (every brand carries an archetype +
//                        royalty), 2 regions, 49 territories with real-ish
//                        coords + a tenure spread, ~18 months of monthly history.
//                        Each dashboard territory is operated by a named FRANCHISEE
//                        (the data controller) — multi-unit operators surface as
//                        one franchisee across several territories.
//   • Operational plane → main's per-brand irvine/tustin franchisees (the booking
//                        + tenancy-isolation demo). Preserved verbatim so the
//                        franchisee-isolation tests still pass.
//
// History is laid down as INPUTS only:
//   • measured plane  → real Slot/Appointment rows (RecomputeRollup derives
//                        jobs_completed / slot_fill_rate / no_show_rate from them)
//   • reported plane  → one MonthlyReport row per (territory, period) holding the
//                        seeded financials + NPS + ratings (labeled Illustrative)
// Scores, roll-ups and watchlist flags are NOT seeded — they are derived in
// RecomputeRollup so there is a single computation path (demo now / real later).
//
// The spread is engineered, not random: 4 clear stars, a healthy middle, and 4
// red at-risk territories each red for a DIFFERENT explainable reason so the
// watchlist and drivers tell real stories:
//   • Atlanta North   — collapsing NPS (customer)
//   • Miami-Dade      — revenue deterioration (growth/financial)
//   • Raleigh-Durham  — no-show spike (measured/ops)
//   • Richmond        — royalty-late → pending_financial_reporting (compliance)
//
// The class is split by concern across api/Seed/*.cs (partial): Run (here) is the
// orchestrator; Catalog seeds brands/regions; Dashboard seeds the dashboard plane;
// Operational seeds the irvine/tustin booking plane; Helpers holds shared utilities.
public static partial class Seed
{
    // Latest fully-reported period is May 2026 (the current June cycle hasn't
    // reported yet — that's what makes the royalty-late story land). 18 months.
    public const int LatestPeriodId = 202605;
    private const int Months = 18;

    // Id ranges are partitioned so dashboard + operational rows never collide:
    //   territory  1..24   dashboard      | 5001.. operational (irvine/tustin)
    //   slot       1..      dashboard      | 800000.. operational
    private const int OperationalTerritoryBase = 5001;
    private const int OperationalSlotBase = 800_000;

    public static void Run(AppDb db)
    {
        db.Database.EnsureCreated();
        if (db.Brands.Any()) return;     // already seeded (idempotent)

        // Bulk insert is large; turn off change detection for speed and re-enable.
        db.ChangeTracker.AutoDetectChangesEnabled = false;
        try
        {
            SeedBrands(db);
            SeedRegions(db);
            var operators = SeedDashboardFranchisees(db);     // operator name -> (slug, num)
            SeedDashboardTerritories(db, operators);
            SeedOperationalFranchisees(db);                   // irvine/tustin per brand (tenancy/booking)
            db.SaveChanges();

            // Appointments now have ids — attach real NPS surveys to a handful of
            // them so those territories read MEASURED nps (ADR-20), then persist.
            SeedDashboardNpsSurveys(db);
            db.SaveChanges();
        }
        finally
        {
            db.ChangeTracker.AutoDetectChangesEnabled = true;
        }
    }
}
