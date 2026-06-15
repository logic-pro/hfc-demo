using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HfcDemo.Data.Config;

// Schema only. The tenant global query filter lives in AppDb.OnModelCreating so it
// can reference the live context tenant (see the note there).
public class TerritoryConfig : IEntityTypeConfiguration<Territory>
{
    public void Configure(EntityTypeBuilder<Territory> b)
    {
        // Every tenant-scoped query carries WHERE FranchiseeId = @t; index it.
        b.HasIndex(x => x.FranchiseeId);
    }
}
