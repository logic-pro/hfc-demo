using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HfcDemo.Data.Config;

// Schema only. The tenant global query filter lives in AppDb.OnModelCreating.
public class AppointmentConfig : IEntityTypeConfiguration<Appointment>
{
    public void Configure(EntityTypeBuilder<Appointment> b)
    {
        // A slot can only be booked once: unique appointment per slot.
        b.HasIndex(x => x.SlotId).IsUnique();

        // Composite (FranchiseeId, StartUtc) serves the ordered appointment lists;
        // BrandId is indexed for cross-franchisee grouping (corporate aggregates).
        b.HasIndex(x => new { x.FranchiseeId, x.StartUtc });
        b.HasIndex(x => x.BrandId);
    }
}
