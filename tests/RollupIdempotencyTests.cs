using HfcDemo;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace HfcDemo.Tests;

// ── Rollup idempotency on a PERSISTED DB (Alpha — live restart-crash fix) ──────
// Root cause of the production restart crash-loop: Seed.Run is guarded
// (if Brands.Any() return), but RecomputeRollup runs on every boot and writes the
// read-model tables (territory_period_summary + watchlist_flag). If Recompute were
// not a true rebuild, a second boot against the SAME (persisted) database would
// re-insert the same rows and dup-key crash. We worked around it in prod with an
// ephemeral /tmp DB; this pins the real invariant.
//
// The fixture keeps ONE in-memory SQLite connection open for its lifetime, and
// every NewDb() shares it — so a second Recompute here is genuinely a "second
// boot against the same persisted DB", not a fresh database. Recompute must
// clear/rebuild the read-model tables so it never throws and row counts stay
// stable no matter how many times it runs.
public class RollupIdempotencyTests : IDisposable
{
    private const int Period = 202605;
    private readonly SqliteConnection _conn;
    private readonly DbContextOptions<AppDb> _options;

    public RollupIdempotencyTests()
    {
        // A private in-memory DB kept alive for the fixture's lifetime, so every
        // NewDb() below talks to the SAME persisted database (the prod scenario).
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _options = new DbContextOptionsBuilder<AppDb>().UseSqlite(_conn).Options;

        using var db = NewDb();
        db.Database.EnsureCreated();
        Seed(db);
    }

    private AppDb NewDb() => new(_options, new TenantContext());

    private static void Seed(AppDb db)
    {
        db.Brands.Add(new Brand { Id = "b1", Num = 1, Name = "Brand One", Archetype = "project_installation", RoyaltyRate = 0.06 });
        db.Franchisees.Add(new Franchisee { Id = "f1", BrandId = "b1", Name = "Op One", Num = 1 });

        db.Territories.Add(Terr(1));
        db.Territories.Add(Terr(2));

        db.MonthlyReports.Add(Report(territoryId: 1, seededNps: 80));
        db.MonthlyReports.Add(Report(territoryId: 2, seededNps: 72));

        // T1 has survey rows so at least one summary takes the measured plane and
        // (depending on thresholds) a watchlist flag can be written — exercising
        // both read-model tables that the rebuild must clear.
        foreach (var score in new[] { 10, 10, 10 })
            db.NpsSurveys.Add(new NpsSurvey
            {
                FranchiseeId = "f1", BrandId = "b1", TerritoryId = 1,
                AppointmentId = db.NpsSurveys.Local.Count + 1, Score = score,
                RespondedAt = new DateTime(2026, 5, 20, 0, 0, 0, DateTimeKind.Utc),
            });

        db.SaveChanges();
    }

    private static Territory Terr(int id) => new()
    {
        Id = id, FranchiseeId = "f1", BrandId = "b1",
        Name = $"Territory {id}", City = "Townsville",
        RegionId = 1, OpenDate = new DateTime(2018, 1, 1, 0, 0, 0, DateTimeKind.Utc),
        Status = "open",
    };

    private static MonthlyReport Report(int territoryId, int seededNps) => new()
    {
        FranchiseeId = "f1", TerritoryId = territoryId, BrandId = "b1", PeriodId = Period,
        PeriodStart = new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc),
        PeriodEnd = new DateTime(2026, 5, 31, 0, 0, 0, DateTimeKind.Utc),
        Reported = true, ReportedAt = new DateTime(2026, 6, 8, 0, 0, 0, DateTimeKind.Utc),
        GrossRevenue = 100_000, RoyaltyCollected = 6_000, SameTerritoryGrowth = 0.05,
        NpsScore = seededNps, GoogleRating = 4.5, QuoteToClose = 0.4,
    };

    private (int Summaries, int Flags) ReadModelCounts()
    {
        using var db = NewDb();
        return (db.TerritoryPeriodSummaries.Count(), db.WatchlistFlags.Count());
    }

    [Fact]
    public void Recompute_OnPersistedDb_IsIdempotent_NoCrash_StableRowCounts()
    {
        // First "boot": populate the read model.
        using (var db = NewDb()) Rollup.Recompute(db);
        var first = ReadModelCounts();
        Assert.True(first.Summaries > 0, "first Recompute should populate the read model");

        // Second "boot" against the SAME persisted DB must not dup-key crash.
        var second = Record.Exception(() => { using var db = NewDb(); Rollup.Recompute(db); });
        Assert.Null(second);

        // A third for good measure — counts must stay stable, not accumulate.
        using (var db = NewDb()) Rollup.Recompute(db);

        var after = ReadModelCounts();
        Assert.Equal(first.Summaries, after.Summaries);
        Assert.Equal(first.Flags, after.Flags);
    }

    public void Dispose() => _conn.Dispose();
}
