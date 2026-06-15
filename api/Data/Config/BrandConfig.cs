using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HfcDemo.Data.Config;

public class BrandConfig : IEntityTypeConfiguration<Brand>
{
    public void Configure(EntityTypeBuilder<Brand> b)
    {
        b.HasKey(x => x.Id);
        b.HasIndex(x => x.Num).IsUnique();
    }
}
