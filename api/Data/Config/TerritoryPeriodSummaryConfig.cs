using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HfcDemo.Data.Config;

// ── Corporate read model: NO tenant query filter ─────────────────────────────
// This is the franchisor's aggregated plane (CONTRACT §1). The corporate/
// franchisee lens is a scope filter Bravo applies pre-query (CONTRACT RBAC), not
// row-level tenancy — these tables are deliberately OUTSIDE the FranchiseeId
// filter. Composite key = (territory_id, period_id); a fresh rollup clears+rewrites
// by it so re-runs never duplicate rows.
public class TerritoryPeriodSummaryConfig : IEntityTypeConfiguration<TerritoryPeriodSummary>
{
    public void Configure(EntityTypeBuilder<TerritoryPeriodSummary> b)
    {
        b.ToTable("territory_period_summary");
        b.HasKey(x => new { x.TerritoryId, x.PeriodId });
        b.HasIndex(x => x.PeriodId);
        b.HasIndex(x => x.BrandId);
        b.HasIndex(x => x.RegionId);
        b.HasIndex(x => new { x.PeriodId, x.CompositeScore });
    }
}
