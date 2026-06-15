using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HfcDemo.Data.Config;

// Schema only. The tenant global query filter lives in AppDb.OnModelCreating.
// NPS is scoped exactly like Appointment: FranchiseeId is the isolation boundary;
// BrandId + TerritoryId ride along denormalized for the dashboard grain.
public class NpsSurveyConfig : IEntityTypeConfiguration<NpsSurvey>
{
    public void Configure(EntityTypeBuilder<NpsSurvey> b)
    {
        // One survey per appointment (the response is the unit of truth).
        // (FranchiseeId, TerritoryId) backs the franchisee dashboard's NPS-by-territory
        // GROUP BY; BrandId is indexed for corporate roll-ups, mirroring Appointment/Slot.
        b.HasIndex(x => x.AppointmentId).IsUnique();
        b.HasIndex(x => new { x.FranchiseeId, x.TerritoryId });
        b.HasIndex(x => x.BrandId);
    }
}
