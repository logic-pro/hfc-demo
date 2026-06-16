using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HfcDemo.Data.Config;

// Corporate read model (CONTRACT §1) — like TerritoryPeriodSummary, NO tenant
// query filter; the corporate/franchisee lens is a pre-query scope filter.
public class WatchlistFlagConfig : IEntityTypeConfiguration<WatchlistFlag>
{
    public void Configure(EntityTypeBuilder<WatchlistFlag> b)
    {
        b.ToTable("watchlist_flag");
        b.HasKey(x => x.WatchlistFlagId);
        b.HasIndex(x => new { x.PeriodId, x.Severity });
        b.HasIndex(x => x.TerritoryId);
    }
}
