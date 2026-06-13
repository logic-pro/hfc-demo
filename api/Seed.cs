namespace HfcDemo;

// Seeds the 8 real HFC brands; under each brand two franchisees (the isolation
// boundary), each with a territory and open slots. Two franchisees per brand
// makes the demo's point: same brand, different franchisee → fully isolated
// (Budget Blinds Irvine must not see Budget Blinds Tustin). Idempotent: skips
// if brands already exist.
public static class Seed
{
    private static readonly (string Id, string Name, string Tagline)[] Brands =
    {
        ("budget-blinds",   "Budget Blinds",      "Custom window coverings, in-home."),
        ("tailored-closet", "The Tailored Closet","Custom closets & storage."),
        ("premier-garage",  "PremierGarage",      "Garage cabinets, floors & storage."),
        ("kitchen-tuneup",  "Kitchen Tune-Up",    "Cabinet refacing & redooring."),
        ("bath-tuneup",     "Bath Tune-Up",       "One-day bath updates."),
        ("two-maids",       "Two Maids",          "Residential cleaning."),
        ("aussie-pet",      "Aussie Pet Mobile",  "Mobile pet grooming."),
        ("lightspeed",      "Lightspeed Restoration","Water, fire & mold restoration."),
    };

    // (region label, city, slug suffix) — each becomes a franchisee per brand.
    private static readonly (string Region, string City, string Slug)[] Regions =
    {
        ("Irvine", "Irvine, CA", "irvine"),
        ("Tustin", "Tustin, CA", "tustin"),
    };

    public static void Run(AppDb db)
    {
        db.Database.EnsureCreated();
        if (db.Brands.Any()) return;     // already seeded

        foreach (var (id, name, tagline) in Brands)
            db.Brands.Add(new Brand { Id = id, Name = name, Tagline = tagline });
        db.SaveChanges();

        // Deterministic-enough demo data anchored to today, 09:00 UTC.
        var baseDay = DateTime.UtcNow.Date.AddHours(9);
        int territoryId = 1;
        foreach (var (brandId, brandName, _) in Brands)
        {
            foreach (var (region, city, slug) in Regions)
            {
                var franchiseeId = $"{brandId}-{slug}";
                db.Franchisees.Add(new Franchisee
                {
                    Id = franchiseeId,
                    BrandId = brandId,
                    Name = $"{brandName} — {region}",
                    Region = region,
                });

                var te = new Territory
                {
                    Id = territoryId++,
                    FranchiseeId = franchiseeId,
                    BrandId = brandId,
                    Name = $"{city} Crew",
                    City = city,
                };
                db.Territories.Add(te);

                // four open slots over the next two days
                for (int d = 0; d < 2; d++)
                    for (int h = 0; h < 2; h++)
                        db.Slots.Add(new Slot
                        {
                            FranchiseeId = franchiseeId,
                            BrandId = brandId,
                            TerritoryId = te.Id,
                            StartUtc = baseDay.AddDays(d).AddHours(h * 3),
                            IsBooked = false,
                            Version = 0,
                        });
            }
        }
        db.SaveChanges();
    }
}
