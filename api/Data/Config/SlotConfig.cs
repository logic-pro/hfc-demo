using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HfcDemo.Data.Config;

// Schema only. The tenant global query filter lives in AppDb.OnModelCreating.
public class SlotConfig : IEntityTypeConfiguration<Slot>
{
    public void Configure(EntityTypeBuilder<Slot> b)
    {
        // Concurrency token for double-booking protection (see Slot.Version).
        b.Property(x => x.Version).IsConcurrencyToken();

        // Composite (FranchiseeId, StartUtc) serves the ordered slot lists;
        // BrandId is indexed for cross-franchisee grouping (corporate aggregates).
        b.HasIndex(x => new { x.FranchiseeId, x.StartUtc });
        b.HasIndex(x => x.BrandId);
    }
}
