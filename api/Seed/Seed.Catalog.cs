namespace HfcDemo;

// Brand + region catalog — the untenanted reference data every plane builds on.
public static partial class Seed
{
    // ── Brand catalog (all 8 kept so existing booking demo still works) ───────
    // Num = numeric dashboard id. All 8 brands now carry an archetype + royalty
    // rate and have dashboard territories (5–8 each, 49 total in Seed.Dashboard.cs).
    private static readonly (string Id, string Name, string Tagline, int Num, string Archetype, double Royalty)[] Brands =
    {
        ("budget-blinds",   "Budget Blinds",         "Custom window coverings, in-home.", 1, "project_installation", 0.05),
        ("two-maids",       "Two Maids",             "Residential cleaning.",             2, "recurring_service",    0.06),
        ("lightspeed",      "Lightspeed Restoration","Water, fire & mold restoration.",   3, "emergency_response",   0.08),
        ("tailored-closet", "The Tailored Closet",   "Custom closets & storage.",         4, "project_installation", 0.05),
        ("premier-garage",  "PremierGarage",         "Garage cabinets, floors & storage.",5, "project_installation", 0.05),
        ("kitchen-tuneup",  "Kitchen Tune-Up",       "Cabinet refacing & redooring.",     6, "project_installation", 0.06),
        ("bath-tuneup",     "Bath Tune-Up",          "One-day bath updates.",             7, "project_installation", 0.06),
        ("aussie-pet",      "Aussie Pet Mobile",     "Mobile pet grooming.",              8, "recurring_service",    0.07),
    };

    private static readonly (int Id, string Name)[] Regions = { (1, "West"), (2, "East") };

    // Per-brand realistic figures (illustrative). Measured capacity (jobs/mo) and
    // reported ticket/gross live on different planes ON PURPOSE — they are not
    // forced to multiply out; the dashboard shows them as separate, separately-
    // labeled tiles. `GrossBase` is a healthy-territory monthly gross.
    private record BrandEcon(int Capacity, double TicketUsd, double GrossBase, string Service);
    private static readonly Dictionary<string, BrandEcon> Econ = new()
    {
        ["budget-blinds"] = new(16, 2600, 95_000, "Window covering install"),
        ["two-maids"]     = new(26,  260, 48_000, "Recurring home cleaning"),
        ["lightspeed"]    = new(16, 4500, 80_000, "Water/fire/mold mitigation"),
        ["tailored-closet"]= new(14, 3200, 88_000, "Custom closet install"),
        ["premier-garage"] = new(12, 4800, 92_000, "Garage cabinet & floor install"),
        ["kitchen-tuneup"] = new(18, 1900, 64_000, "Cabinet refacing"),
        ["bath-tuneup"]    = new(20, 1400, 52_000, "One-day bath update"),
        ["aussie-pet"]     = new(30,   95, 28_000, "Mobile pet grooming"),
    };

    private static void SeedBrands(AppDb db)
    {
        foreach (var (id, name, tagline, num, arch, royalty) in Brands)
            db.Brands.Add(new Brand { Id = id, Name = name, Tagline = tagline,
                Num = num, Archetype = arch, RoyaltyRate = royalty });
    }

    private static void SeedRegions(AppDb db)
    {
        foreach (var (id, name) in Regions)
            db.Regions.Add(new Region { Id = id, Name = name });
    }
}
