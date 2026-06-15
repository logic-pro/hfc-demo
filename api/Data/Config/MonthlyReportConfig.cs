using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HfcDemo.Data.Config;

// Schema only. The tenant global query filter lives in AppDb.OnModelCreating.
public class MonthlyReportConfig : IEntityTypeConfiguration<MonthlyReport>
{
    public void Configure(EntityTypeBuilder<MonthlyReport> b)
    {
        // Reported plane: one row per (territory, period); read by the rollup.
        b.HasIndex(x => x.FranchiseeId);
        b.HasIndex(x => new { x.TerritoryId, x.PeriodId }).IsUnique();
    }
}
