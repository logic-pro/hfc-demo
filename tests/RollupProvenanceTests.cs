using HfcDemo;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace HfcDemo.Tests;

// ── Round 3 / ADR-20 — corporate rollup NPS provenance hardening (Alpha) ──────
// RecomputeRollup flips NPS to the MEASURED plane (D-NPS-SWAP), sourcing it from
// real NpsSurvey rows. These tests pin the provenance edge that hardening must
// guarantee: a territory with ZERO surveys must NOT be presented as measured.
//   • It falls back to the seeded report value (so the demo keeps a signal) and
//     that value is never the 0 an empty survey set would average to.
//   • Its stored row is marked RefreshStatus = "seeded", so a seeded value can
//     never read as measured/current downstream.
// A sibling territory WITH surveys is computed from the survey rows and marked
// "current". Watchlist behaviour is intentionally untouched this round.
//
// Drives RecomputeRollup directly against an isolated in-memory SQLite AppDb
// (the corporate read-model plane has no tenant query filter, so reads are
// unfiltered; Recompute itself crosses tenants via IgnoreQueryFilters()).
public class RollupProvenanceTests : IDisposable
{
    private const int Period = 202605;
    private readonly SqliteConnection _conn;
    private readonly DbContextOptions<AppDb> _options;

    public RollupProvenanceTests()
    {
        // A private in-memory DB kept alive for the fixture's lifetime.
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _options = new DbContextOptionsBuilder<AppDb>().UseSqlite(_conn).Options;

        using var db = NewDb();
        db.Database.EnsureCreated();
        Seed(db);
    }

    // Empty tenant context: Recompute reads cross-tenant via IgnoreQueryFilters,
    // and the read-model tables carry no tenant filter, so reads are unfiltered.
    private AppDb NewDb() => new(_options, new TenantContext());

    private static void Seed(AppDb db)
    {
        db.Brands.Add(new Brand { Id = "b1", Num = 1, Name = "Brand One", Archetype = "project_installation", RoyaltyRate = 0.06 });
        db.Franchisees.Add(new Franchisee { Id = "f1", BrandId = "b1", Name = "Op One", Num = 1 });

        // T1 has real surveys (measured NPS); T2 has none (seeded fallback).
        db.Territories.Add(Terr(1));
        db.Territories.Add(Terr(2));

        // Seeded reported plane: distinct seeded NPS values so we can prove the
        // measured territory ignores its seed and the unmeasured one keeps it.
        db.MonthlyReports.Add(Report(territoryId: 1, seededNps: 80));
        db.MonthlyReports.Add(Report(territoryId: 2, seededNps: 72));

        // T1 surveys → all promoters → measured NPS = 100 (≠ its seeded 80).
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

    private TerritoryPeriodSummary SummaryFor(int territoryId)
    {
        using var db = NewDb();
        return db.TerritoryPeriodSummaries.Single(s => s.TerritoryId == territoryId && s.PeriodId == Period);
    }

    [Fact]
    public void TerritoryWithSurveys_GetsMeasuredNps_AndCurrentRefreshStatus()
    {
        using (var db = NewDb()) Rollup.Recompute(db);

        var s = SummaryFor(1);
        Assert.Equal(100, s.NpsScore);          // measured from surveys, not the seeded 80
        Assert.Equal("current", s.RefreshStatus);
    }

    [Fact]
    public void TerritoryWithoutSurveys_FallsBackToSeeded_NeverZero_AndIsMarkedSeeded()
    {
        using (var db = NewDb()) Rollup.Recompute(db);

        var s = SummaryFor(2);
        Assert.NotEqual(0, s.NpsScore);         // never the 0 an empty survey set averages to
        Assert.Equal(72, s.NpsScore);           // the seeded report value is the fallback
        Assert.Equal("seeded", s.RefreshStatus); // a seeded value never reads as measured/current
    }

    [Fact]
    public void SeededNps_DoesNotRaiseWatchlistFlag_ProvenanceOnlyRound()
    {
        using (var db = NewDb()) Rollup.Recompute(db);

        using var read = NewDb();
        // Both territories' NPS (measured 100, seeded 72) are above threshold, so
        // no nps_below_threshold flag should exist — watchlist logic is unchanged.
        Assert.DoesNotContain(read.WatchlistFlags.ToList(), f => f.FlagKey == "nps_below_threshold");
    }

    public void Dispose() => _conn.Dispose();
}
