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

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Brand>().HasKey(x => x.Id);
        b.Entity<Franchisee>().HasKey(x => x.Id);
        b.Entity<Franchisee>().HasIndex(x => x.BrandId);   // group franchisees by brand

        // Tenant isolation: the same global-query-filter mechanism as before,
        // re-keyed from BrandId to the FranchiseeId resolved from the token
        // claim. With no franchisee set, EF compares against null and returns
        // nothing — fail-closed, never cross-tenant.
        b.Entity<Territory>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
        b.Entity<Slot>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
        b.Entity<Appointment>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);
        // NPS is scoped exactly like Appointment: FranchiseeId is the isolation
        // boundary; BrandId + TerritoryId ride along denormalized for the dashboard
        // grain (corporate roll-up by brand, franchisee aggregation by territory).
        b.Entity<NpsSurvey>().HasQueryFilter(x => x.FranchiseeId == _tenant.FranchiseeId);

        // Concurrency token for double-booking protection (see Slot.Version).
        b.Entity<Slot>().Property(x => x.Version).IsConcurrencyToken();

        // A slot can only be booked once: unique appointment per slot.
        b.Entity<Appointment>().HasIndex(x => x.SlotId).IsUnique();

        // Every tenant-scoped query carries WHERE FranchiseeId = @t; index it.
        // Composite (FranchiseeId, StartUtc) serves the ordered slot/appt lists.
        // BrandId is indexed too for cross-franchisee grouping (corporate aggregates).
        b.Entity<Territory>().HasIndex(x => x.FranchiseeId);
        b.Entity<Slot>().HasIndex(x => new { x.FranchiseeId, x.StartUtc });
        b.Entity<Slot>().HasIndex(x => x.BrandId);
        b.Entity<Appointment>().HasIndex(x => new { x.FranchiseeId, x.StartUtc });
        b.Entity<Appointment>().HasIndex(x => x.BrandId);

        // NPS: one survey per appointment (the response is the unit of truth).
        // (FranchiseeId, TerritoryId) backs the franchisee dashboard's NPS-by-territory
        // GROUP BY — the territory-resolvable feed; BrandId is indexed for corporate
        // roll-ups, mirroring Appointment/Slot.
        b.Entity<NpsSurvey>().HasIndex(x => x.AppointmentId).IsUnique();
        b.Entity<NpsSurvey>().HasIndex(x => new { x.FranchiseeId, x.TerritoryId });
        b.Entity<NpsSurvey>().HasIndex(x => x.BrandId);
    }
}
