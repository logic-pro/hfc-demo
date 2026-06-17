using Microsoft.EntityFrameworkCore;

namespace HfcDemo;

// Holds the tenant resolved for the current request (scoped). Populated by
// TenantResolver.Populate from the VERIFIED token's claims (see Auth.cs), not
// from any client-supplied header. Read by the global query filter below.
public class TenantContext
{
    public string? FranchiseeId { get; set; }   // isolation key (boundary)
    public string? BrandId { get; set; }         // grouping (not a boundary)
}

public class AppDb : DbContext
{
    private readonly TenantContext _tenant;
    public AppDb(DbContextOptions<AppDb> options, TenantContext tenant) : base(options)
        => _tenant = tenant;

    public DbSet<Brand> Brands => Set<Brand>();
    public DbSet<Franchisee> Franchisees => Set<Franchisee>();
    public DbSet<Territory> Territories => Set<Territory>();
    public DbSet<Slot> Slots => Set<Slot>();
    public DbSet<Appointment> Appointments => Set<Appointment>();
    public DbSet<NpsSurvey> NpsSurveys => Set<NpsSurvey>();

    // ── Dashboard: operational reference + reported plane (D0) ────────────────
    public DbSet<Region> Regions => Set<Region>();
    public DbSet<MonthlyReport> MonthlyReports => Set<MonthlyReport>();

    // ── Dashboard: corporate read model (D2/D5) ──────────────────────────────
    public DbSet<TerritoryPeriodSummary> TerritoryPeriodSummaries => Set<TerritoryPeriodSummary>();
    public DbSet<WatchlistFlag> WatchlistFlags => Set<WatchlistFlag>();

    // ── Reporting: saved report definitions (§C2) ─────────────────────────────
    // Corporate plane — no tenant query filter (read-down scope filter at request
    // time, mirroring the read-model tables above).
    public DbSet<Reporting.SavedReport> SavedReports => Set<Reporting.SavedReport>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Schema config (keys, indexes, table mappings, the Slot concurrency token)
        // lives in api/Data/Config/** as one IEntityTypeConfiguration per entity,
        // applied here by assembly scan. Region carries no explicit configuration
        // (EF defaults suffice), mirroring the original model.
        b.ApplyConfigurationsFromAssembly(typeof(AppDb).Assembly);

        // Tenant isolation: the global query filter keys on the FranchiseeId
        // resolved from the verified token claim (two-axis model — franchisee is
        // the boundary, brand only the grouping). With no franchisee set, EF
        // compares against null and returns nothing — fail-closed, never cross-tenant.
        //
        // These MUST stay here, not in the IEntityTypeConfiguration classes: the
        // filter has to reference the live DbContext field (_tenant) so EF
        // re-evaluates the current franchisee per query. A filter captured by a
        // configuration object would freeze to the model-build-time tenant (the
        // seeding scope → null) and return nothing for every request.
        b.Entity<Territory>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
        b.Entity<Slot>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
        b.Entity<Appointment>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
        // NPS is scoped exactly like Appointment; MonthlyReport is franchisee-owned
        // operational data — same boundary. Only RecomputeRollup reads MonthlyReport
        // cross-tenant, via IgnoreQueryFilters().
        b.Entity<NpsSurvey>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
        b.Entity<MonthlyReport>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
    }
}
