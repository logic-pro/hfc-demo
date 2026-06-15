namespace HfcDemo;

// Operational plane (main's model): every brand gets an irvine + tustin
// FRANCHISEE — same brand, two franchisees, fully isolated — each with a
// territory and four open future slots. This backs the booking demo and the
// franchisee-isolation tests (budget-blinds-irvine must not see -tustin).
// These franchisees are NOT in the dashboard set (RegionId null, Num 0).
public static partial class Seed
{
    private static readonly (string Region, string City, string Slug)[] OperationalRegions =
    {
        ("Irvine", "Irvine, CA", "irvine"),
        ("Tustin", "Tustin, CA", "tustin"),
    };

    private static void SeedOperationalFranchisees(AppDb db)
    {
        var baseDay = DateTime.UtcNow.Date.AddHours(9);
        int territoryId = OperationalTerritoryBase;
        int slotId = OperationalSlotBase;
        foreach (var (brandId, brandName, _, _, _, _) in Brands)
        {
            foreach (var (region, city, slug) in OperationalRegions)
            {
                var franchiseeId = $"{brandId}-{slug}";
                db.Franchisees.Add(new Franchisee
                {
                    Id = franchiseeId, BrandId = brandId,
                    Name = $"{brandName} — {region}", Region = region, Num = 0,
                });

                var te = new Territory
                {
                    Id = territoryId++, FranchiseeId = franchiseeId, BrandId = brandId,
                    Name = $"{city} Crew", City = city, Status = "open",
                    // RegionId null → excluded from the dashboard read model.
                };
                db.Territories.Add(te);

                for (int d = 0; d < 2; d++)
                    for (int h = 0; h < 2; h++)
                        db.Slots.Add(new Slot
                        {
                            Id = slotId++, FranchiseeId = franchiseeId, BrandId = brandId,
                            TerritoryId = te.Id,
                            StartUtc = baseDay.AddDays(d).AddHours(h * 3),
                            IsBooked = false, Version = 0,
                        });
            }
        }
    }
}
