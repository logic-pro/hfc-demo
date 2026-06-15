using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HfcDemo.Data.Config;

public class FranchiseeConfig : IEntityTypeConfiguration<Franchisee>
{
    public void Configure(EntityTypeBuilder<Franchisee> b)
    {
        b.HasKey(x => x.Id);
        b.HasIndex(x => x.BrandId);   // group franchisees by brand
    }
}
