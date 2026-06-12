using Microsoft.EntityFrameworkCore;

namespace HfcDemo;

// Holds the tenant resolved for the current request (scoped). Set by
// TenantMiddleware from the X-Tenant-Id header; read by the query filter below.
public class TenantContext
{
    public string? BrandId { get; set; }
}

public class AppDb : DbContext
{
    private readonly TenantContext _tenant;
    public AppDb(DbContextOptions<AppDb> options, TenantContext tenant) : base(options)
        => _tenant = tenant;

    public DbSet<Brand> Brands => Set<Brand>();
    public DbSet<Territory> Territories => Set<Territory>();
    public DbSet<Slot> Slots => Set<Slot>();
    public DbSet<Appointment> Appointments => Set<Appointment>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Brand>().HasKey(x => x.Id);

        // Tenant isolation: every tenant-scoped entity is filtered to the
        // current BrandId. With no tenant set, EF compares against null and
        // returns nothing — fail-closed, never cross-tenant.
        b.Entity<Territory>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
        b.Entity<Slot>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);
        b.Entity<Appointment>().HasQueryFilter(x => x.BrandId == _tenant.BrandId);

        // Concurrency token for double-booking protection (see Slot.Version).
        b.Entity<Slot>().Property(x => x.Version).IsConcurrencyToken();

        // A slot can only be booked once: unique appointment per slot.
        b.Entity<Appointment>().HasIndex(x => x.SlotId).IsUnique();

        // Every tenant-scoped query carries WHERE BrandId = @t; index it.
        // Composite (BrandId, StartUtc) serves the ordered slot/appointment lists.
        b.Entity<Territory>().HasIndex(x => x.BrandId);
        b.Entity<Slot>().HasIndex(x => new { x.BrandId, x.StartUtc });
        b.Entity<Appointment>().HasIndex(x => new { x.BrandId, x.StartUtc });
    }
}
