using System.Text;

namespace HfcDemo;

// ── D1 seed — the believable, deliberately dramatic demo world ───────────────
// Seeds the data SPINE on main's two-axis tenancy (franchisee = isolation key,
// brand = grouping):
//   • Dashboard plane  → 8 catalog brands (3 the dashboard demo set across the 3
//                        archetypes), 2 regions, 24 territories with real-ish
//                        coords + a tenure spread, ~18 months of monthly history.
//                        Each dashboard territory is operated by a named FRANCHISEE
//                        (the data controller) — multi-unit operators surface as
//                        one franchisee across several territories.
//   • Operational plane → main's per-brand irvine/tustin franchisees (the booking
//                        + tenancy-isolation demo). Preserved verbatim so the
//                        franchisee-isolation tests still pass.
//
// History is laid down as INPUTS only:
//   • measured plane  → real Slot/Appointment rows (RecomputeRollup derives
//                        jobs_completed / slot_fill_rate / no_show_rate from them)
//   • reported plane  → one MonthlyReport row per (territory, period) holding the
//                        seeded financials + NPS + ratings (labeled Illustrative)
// Scores, roll-ups and watchlist flags are NOT seeded — they are derived in
// RecomputeRollup so there is a single computation path (demo now / real later).
//
// The spread is engineered, not random: 4 clear stars, a healthy middle, and 4
// red at-risk territories each red for a DIFFERENT explainable reason so the
// watchlist and drivers tell real stories:
//   • Atlanta North   — collapsing NPS (customer)
//   • Miami-Dade      — revenue deterioration (growth/financial)
//   • Raleigh-Durham  — no-show spike (measured/ops)
//   • Richmond        — royalty-late → pending_financial_reporting (compliance)
public static class Seed
{
    // Latest fully-reported period is May 2026 (the current June cycle hasn't
    // reported yet — that's what makes the royalty-late story land). 18 months.
    public const int LatestPeriodId = 202605;
    private const int Months = 18;

    // Id ranges are partitioned so dashboard + operational rows never collide:
    //   territory  1..24   dashboard      | 5001.. operational (irvine/tustin)
    //   slot       1..      dashboard      | 800000.. operational
    private const int OperationalTerritoryBase = 5001;
    private const int OperationalSlotBase = 800_000;

    // ── Brand catalog (all 8 kept so existing booking demo still works) ───────
    // Num = numeric dashboard id. The 3 dashboard brands carry an archetype +
    // royalty rate; the other 5 stay catalog-only (no archetype, no dashboard data).
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

    // tenure → open date (anchored so the band is realistic at the latest period)
    private static DateTime OpenFor(string tenure) => tenure switch
    {
        "mature"      => new DateTime(2019, 5, 1),
        "established" => new DateTime(2022, 9, 1),
        "ramping"     => new DateTime(2025, 3, 1),
        "launch"      => new DateTime(2026, 2, 1),
        _             => new DateTime(2022, 9, 1),
    };

    // A territory's seed profile. `tier` sets the latest-period targets; `reason`
    // overrides a specific trajectory for the red stories. Metrics are interpolated
    // across the window + a seasonal wave so every sparkline is alive, not flat.
    private record Prof(
        int Id, string Brand, string Name, string City, int Region,
        double Lat, double Lng, string Tenure, string Franchisee,
        string Tier, string Reason);

    private static readonly Prof[] Territories =
    {
        // ── Budget Blinds (project_installation) — ids 1..8 ───────────────────
        new(1, "budget-blinds","Orange County North","Anaheim, CA",1,33.83,-117.91,"mature",     "Pacific Shade Partners LLC","star",   ""),
        new(2, "budget-blinds","Phoenix Central",     "Phoenix, AZ", 1,33.45,-112.07,"established","Sonoran Window Co",         "strong", ""),
        new(3, "budget-blinds","Denver Metro",        "Denver, CO",  1,39.74,-104.99,"mature",     "Front Range Coverings LLC", "healthy",""),
        new(4, "budget-blinds","Las Vegas Valley",    "Las Vegas, NV",1,36.17,-115.14,"established","Silver State Interiors",    "average",""),
        new(5, "budget-blinds","Tampa Bay",           "Tampa, FL",   2,27.95,-82.46,"established", "Peachtree Home Services Group","soft", ""),
        new(6, "budget-blinds","Atlanta North",       "Atlanta, GA", 2,33.95,-84.39,"established", "Peachtree Home Services Group","atrisk","nps_collapse"),
        new(7, "budget-blinds","Charlotte Metro",     "Charlotte, NC",2,35.23,-80.84,"mature",     "Carolina Light & Shade",    "healthy",""),
        new(8, "budget-blinds","Miami-Dade",          "Miami, FL",   2,25.76,-80.19,"established", "Peachtree Home Services Group","atrisk","revenue_deterioration"),

        // ── Two Maids (recurring_service) — ids 9..16 ─────────────────────────
        new( 9,"two-maids","San Diego Coast", "San Diego, CA",   1,32.72,-117.16,"mature",     "Coastal Clean Holdings",      "star",   ""),
        new(10,"two-maids","Sacramento Valley","Sacramento, CA", 1,38.58,-121.49,"established","Capitol Home Care LLC",       "strong", ""),
        new(11,"two-maids","Salt Lake City",  "Salt Lake City, UT",1,40.76,-111.89,"ramping",  "Wasatch Domestic Services",   "average",""),
        new(12,"two-maids","Portland Metro",  "Portland, OR",    1,45.52,-122.68,"established","Rose City Cleaning Co",       "healthy",""),
        new(13,"two-maids","Nashville",       "Nashville, TN",   2,36.16,-86.78,"mature",     "Music City Home Services",    "healthy",""),
        new(14,"two-maids","Columbus",        "Columbus, OH",    2,39.96,-82.99,"established","Buckeye Clean Partners",      "soft",   ""),
        new(15,"two-maids","Raleigh-Durham",  "Raleigh, NC",     2,35.79,-78.64,"established","Triangle Domestic Group",     "atrisk", "no_show_spike"),
        new(16,"two-maids","Orlando",         "Orlando, FL",     2,28.54,-81.38,"established","Sunshine Home Care LLC",      "average",""),

        // ── Lightspeed Restoration (emergency_response) — ids 17..24 ──────────
        new(17,"lightspeed","Seattle Metro",  "Seattle, WA",     1,47.61,-122.33,"established","Cascade Restoration Group",   "strong", ""),
        new(18,"lightspeed","Bay Area East",  "Oakland, CA",     1,37.80,-122.27,"mature",     "Bay Restoration Partners",    "star",   ""),
        new(19,"lightspeed","Tucson",         "Tucson, AZ",      1,32.22,-110.97,"established","Old Pueblo Recovery LLC",     "healthy",""),
        new(20,"lightspeed","Boise",          "Boise, ID",       1,43.62,-116.20,"launch",     "Treasure Valley Restoration", "soft",   ""),
        new(21,"lightspeed","Charleston",     "Charleston, SC",  2,32.78,-79.93,"established","Lowcountry Recovery Co",      "healthy",""),
        new(22,"lightspeed","Jacksonville",   "Jacksonville, FL",2,30.33,-81.66,"established","First Coast Restoration LLC", "average",""),
        new(23,"lightspeed","Richmond",       "Richmond, VA",    2,37.54,-77.44,"established","Commonwealth Recovery Group", "atrisk", "royalty_late"),
        new(24,"lightspeed","Savannah",       "Savannah, GA",    2,32.08,-81.09,"established","Coastal Empire Restoration",  "soft",   ""),

        // ── The Tailored Closet (project_installation) — ids 25..29 ───────────
        new(25,"tailored-closet","Austin Metro",       "Austin, TX",     2,30.27,-97.74, "established","Hill Country Closets LLC",   "strong", ""),
        new(26,"tailored-closet","Dallas North",       "Dallas, TX",     2,32.78,-96.80, "mature",     "Trinity Storage Solutions", "star",   ""),
        new(27,"tailored-closet","Scottsdale",         "Scottsdale, AZ", 1,33.49,-111.92,"established","Sonoran Closet Co",          "healthy",""),
        new(28,"tailored-closet","Twin Cities",        "Minneapolis, MN",2,44.98,-93.27, "established","North Star Organizers",      "average",""),
        new(29,"tailored-closet","Sacramento Foothills","Roseville, CA",  1,38.75,-121.29,"ramping",   "Capital Closet Works",       "soft",   ""),

        // ── PremierGarage (project_installation) — ids 30..34 ─────────────────
        new(30,"premier-garage","Houston West",        "Houston, TX",    2,29.76,-95.37, "established","Bayou Garage Systems",       "strong", ""),
        new(31,"premier-garage","Chicago North Shore", "Evanston, IL",   2,42.05,-87.69, "mature",     "Lakeshore Garage Co",       "healthy",""),
        new(32,"premier-garage","Phoenix East Valley", "Mesa, AZ",       1,33.42,-111.83,"established","Desert Garage Pros",         "average",""),
        new(33,"premier-garage","Silicon Valley",      "San Jose, CA",   1,37.34,-121.89,"mature",     "Valley Garage Interiors",   "star",   ""),
        new(34,"premier-garage","Kansas City",         "Kansas City, MO",2,39.10,-94.58, "ramping",   "Heartland Garage Works",     "soft",   ""),

        // ── Kitchen Tune-Up (project_installation) — ids 35..39 ───────────────
        new(35,"kitchen-tuneup","Charlotte South",     "Charlotte, NC",  2,35.10,-80.86, "established","Queen City Kitchens",       "healthy",""),
        new(36,"kitchen-tuneup","Indianapolis",        "Indianapolis, IN",2,39.77,-86.16,"established","Crossroads Cabinet Co",      "average",""),
        new(37,"kitchen-tuneup","Las Vegas Summerlin", "Las Vegas, NV",  1,36.16,-115.33,"ramping",   "Mojave Kitchen Works",       "soft",   ""),
        new(38,"kitchen-tuneup","Portland West",       "Beaverton, OR",  1,45.49,-122.80,"established","Cascade Cabinet Refacing",   "strong", ""),
        new(39,"kitchen-tuneup","Atlanta South",       "Atlanta, GA",    2,33.65,-84.42, "established","Southside Kitchen Group",    "atrisk", "revenue_deterioration"),

        // ── Bath Tune-Up (project_installation) — ids 40..44 ──────────────────
        new(40,"bath-tuneup","Tampa North",            "Tampa, FL",      2,28.07,-82.45, "established","Gulf Coast Baths LLC",       "strong", ""),
        new(41,"bath-tuneup","Denver South",           "Centennial, CO", 1,39.58,-104.88,"established","Mile High Bath Co",          "healthy",""),
        new(42,"bath-tuneup","Salt Lake South",        "Sandy, UT",      1,40.57,-111.88,"ramping",   "Wasatch Bath Works",         "average",""),
        new(43,"bath-tuneup","Columbus East",          "Columbus, OH",   2,39.99,-82.89, "established","Buckeye Bath Updates",       "soft",   ""),
        new(44,"bath-tuneup","Nashville South",        "Franklin, TN",   2,35.92,-86.87, "established","Music City Baths",           "atrisk", "no_show_spike"),

        // ── Aussie Pet Mobile (recurring_service) — ids 45..49 ────────────────
        new(45,"aussie-pet","San Diego North",         "Carlsbad, CA",   1,33.16,-117.35,"mature",     "Coastal Pet Care Co",       "star",   ""),
        new(46,"aussie-pet","South County",            "Mission Viejo, CA",1,33.60,-117.67,"established","South County Pet Spa",     "strong", ""),
        new(47,"aussie-pet","Seattle Eastside",        "Bellevue, WA",   1,47.61,-122.20,"established","Eastside Pet Mobile",        "healthy",""),
        new(48,"aussie-pet","Austin South",            "Austin, TX",     2,30.20,-97.79, "ramping",   "Lone Star Pet Grooming",     "average",""),
        new(49,"aussie-pet","Charlotte North",         "Huntersville, NC",2,35.41,-80.84,"established","Carolina Mobile Pets",       "soft",   ""),
    };

    public static void Run(AppDb db)
    {
        db.Database.EnsureCreated();
        if (db.Brands.Any()) return;     // already seeded (idempotent)

        // Bulk insert is large; turn off change detection for speed and re-enable.
        db.ChangeTracker.AutoDetectChangesEnabled = false;
        try
        {
            SeedBrands(db);
            SeedRegions(db);
            var operators = SeedDashboardFranchisees(db);     // operator name -> (slug, num)
            SeedDashboardTerritories(db, operators);
            SeedOperationalFranchisees(db);                   // irvine/tustin per brand (tenancy/booking)
            db.SaveChanges();
        }
        finally
        {
            db.ChangeTracker.AutoDetectChangesEnabled = true;
        }
    }

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

    // Dashboard franchisees (the data controllers). De-duplicated by name so
    // multi-unit operators (e.g. Peachtree Home Services Group runs Tampa +
    // Atlanta + Miami) surface as ONE franchisee across several at-risk
    // territories — a real franchisor story. Each gets:
    //   • Id   = slug of the operator name (the operational isolation key)
    //   • Num  = numeric dashboard id (the read model's franchisee_id, CONTRACT §1)
    // Returns operator name -> (slug, num) for the territory/slot seeding below.
    private static Dictionary<string, (string Slug, int Num)> SeedDashboardFranchisees(AppDb db)
    {
        var map = new Dictionary<string, (string, int)>();
        int next = 1;
        foreach (var p in Territories)
        {
            if (map.ContainsKey(p.Franchisee)) continue;
            var slug = Slugify(p.Franchisee);
            var regionName = Regions.First(r => r.Id == p.Region).Name;
            db.Franchisees.Add(new Franchisee
            {
                Id = slug, BrandId = p.Brand, Name = p.Franchisee,
                Region = regionName, Num = next,
            });
            map[p.Franchisee] = (slug, next);
            next++;
        }
        return map;
    }

    private static void SeedDashboardTerritories(AppDb db, Dictionary<string, (string Slug, int Num)> operators)
    {
        int slotId = 1;
        var bookingBase = DateTime.UtcNow.Date.AddHours(9);

        foreach (var p in Territories)
        {
            var econ = Econ[p.Brand];
            var openDate = OpenFor(p.Tenure);
            var franchiseeId = operators[p.Franchisee].Slug;   // operational isolation key
            db.Territories.Add(new Territory
            {
                Id = p.Id, FranchiseeId = franchiseeId, BrandId = p.Brand,
                Name = p.Name, City = p.City,
                RegionId = p.Region, Lat = p.Lat, Lng = p.Lng,
                OpenDate = openDate, Status = "open",
            });

            // ~18 months of history (only periods on/after the territory opened).
            for (int i = 0; i < Months; i++)
            {
                var (periodId, pStart, pEnd) = PeriodAt(i);
                if (pEnd < openDate) continue;          // no data before open

                double t = Months == 1 ? 1 : (double)i / (Months - 1); // 0=oldest..1=latest
                double wave = 1 + 0.045 * Math.Sin(i * 0.9 + p.Id);     // seasonal aliveness

                var m = Trajectory(p, econ, i, t, wave);

                // ── measured plane: real Slot/Appointment rows ───────────────
                int capacity = econ.Capacity;
                int booked = (int)Math.Round(capacity * m.Fill);
                int noShows = (int)Math.Round(booked * m.NoShow);
                int cancels = (int)Math.Round(booked * 0.04);
                int completed = Math.Max(0, booked - noShows - cancels);

                for (int s = 0; s < capacity; s++)
                {
                    var start = pStart.AddDays(s % 26).AddHours(9 + (s % 6));
                    bool isBooked = s < booked;
                    db.Slots.Add(new Slot
                    {
                        Id = slotId, FranchiseeId = franchiseeId, BrandId = p.Brand,
                        TerritoryId = p.Id, StartUtc = start, IsBooked = isBooked, Version = 0,
                    });
                    if (isBooked)
                    {
                        // status order: completed first, then cancels, then no_shows
                        string status = s < completed ? "completed"
                                      : s < completed + cancels ? "cancelled"
                                      : "no_show";
                        db.Appointments.Add(new Appointment
                        {
                            FranchiseeId = franchiseeId, BrandId = p.Brand,
                            TerritoryId = p.Id, SlotId = slotId,
                            StartUtc = start, CustomerName = $"Customer {p.Id}-{periodId}-{s}",
                            Service = econ.Service, Status = status,
                            InvoiceCents = status == "completed" ? (int)(econ.TicketUsd * 100) : 0,
                        });
                    }
                    slotId++;
                }

                // ── reported plane: one MonthlyReport (seeded financials + NPS) ──
                // royalty_late: the LATEST cycle's financial report hasn't arrived
                // (Reported=false) → financial pending. The customer survey (NPS/
                // rating/quote) still came in, so only the financial plane is gone.
                bool financialReported = !(p.Reason == "royalty_late" && periodId == LatestPeriodId);
                double royaltyRate = Brands.First(b => b.Id == p.Brand).Royalty;
                double royaltyRevenue = m.Gross * royaltyRate;
                // collection: stars/strong remit fully; soft/at-risk lag a little
                double collectRate = m.Gross <= 0 ? 0
                    : p.Tier is "star" or "strong" or "healthy" ? 1.0
                    : p.Tier == "average" ? 0.97 : 0.92;

                db.MonthlyReports.Add(new MonthlyReport
                {
                    FranchiseeId = franchiseeId,
                    TerritoryId = p.Id, BrandId = p.Brand, PeriodId = periodId,
                    PeriodStart = pStart, PeriodEnd = pEnd,
                    Reported = financialReported,
                    ReportedAt = financialReported ? pEnd.AddDays(8) : null,
                    GrossRevenue = financialReported ? m.Gross : 0,
                    RoyaltyCollected = financialReported ? royaltyRevenue * collectRate : 0,
                    SameTerritoryGrowth = m.Growth,
                    Mrr = p.Brand == "two-maids" ? m.Gross * 0.7 : 0, // recurring only
                    NpsScore = m.Nps,
                    GoogleRating = m.GoogleRating,
                    QuoteToClose = m.Quote,
                });
            }

            // A few FUTURE open slots so the booking demo still works for these
            // brands (historical slots above are all in the past).
            for (int d = 0; d < 2; d++)
                for (int h = 0; h < 2; h++)
                    db.Slots.Add(new Slot
                    {
                        Id = slotId++, FranchiseeId = franchiseeId, BrandId = p.Brand,
                        TerritoryId = p.Id,
                        StartUtc = bookingBase.AddDays(d).AddHours(h * 3),
                        IsBooked = false, Version = 0,
                    });
        }
    }

    // Measured + reported targets for one territory-period.
    private record Metrics(double Fill, double NoShow, int Nps, double Gross,
        double Growth, double GoogleRating, double Quote);

    private static Metrics Trajectory(Prof p, BrandEcon econ, int i, double t, double wave)
    {
        // Tier sets the LATEST-period targets; earlier periods interpolate up from
        // a lower start (so growth shows) with the seasonal wave layered on.
        // Healthy tiers keep NPS above the 50 watchlist line so the ONLY NPS
        // story is the deliberate collapse (Atlanta) — not a flood of flags.
        (double fillEnd, int npsEnd, double grossMult, double noShow, double growth,
         double rating, double quote) = p.Tier switch
        {
            "star"    => (0.94, 80, 1.60, 0.03,  0.13, 4.8, 0.46),
            "strong"  => (0.87, 68, 1.25, 0.05,  0.06, 4.6, 0.40),
            "healthy" => (0.79, 58, 1.00, 0.06,  0.02, 4.4, 0.35),
            "average" => (0.74, 55, 0.86, 0.07,  0.00, 4.2, 0.31),
            "soft"    => (0.69, 53, 0.72, 0.09, -0.03, 4.0, 0.27),
            _         => (0.70, 52, 0.80, 0.07, -0.02, 4.1, 0.30), // atrisk default
        };

        // Interpolate each metric from a lower "start" to the latest "end".
        double Lerp(double start, double end) => start + (end - start) * t;
        double fill    = Lerp(fillEnd * 0.82, fillEnd) * wave;
        double gross   = econ.GrossBase * grossMult * Lerp(0.80, 1.0) * wave;
        int nps        = (int)Math.Round(Lerp(npsEnd - 8, npsEnd) + 3 * Math.Sin(i * 0.7));
        double ratingV = rating;                 // ratings barely drift in the demo
        double quoteV  = quote * wave;
        double noShowV = noShow * (2 - wave);    // small inverse seasonal jitter
        int fromLatest = (Months - 1) - i;       // 0 = latest period

        // ── red-story overrides ──────────────────────────────────────────────
        // Each at-risk territory is broadly soft (so its composite reads RED on
        // the map) but has ONE *signature* catastrophic metric that matches its
        // watchlist flag + top driver — the distinct, explainable reason.
        switch (p.Reason)
        {
            case "nps_collapse":
                // SIGNATURE: NPS falls off a cliff over the last 3 periods (→33),
                // crossing the 50 line. Reputation drag softens fill + bumps
                // no-shows recently, so the composite is red but NPS is the story.
                nps = fromLatest switch { 0 => 33, 1 => 40, 2 => 48, _ => 56 + (int)(2 * Math.Sin(i)) };
                // reputation drag softens demand (fill) without tripping the
                // no-show flag — NPS stays Atlanta's single signature reason.
                fill = (fromLatest <= 1 ? 0.55 : Lerp(0.70 * 0.82, 0.70)) * wave;
                noShowV = fromLatest <= 1 ? 0.12 : noShowV;
                gross = econ.GrossBase * 0.66 * Lerp(0.85, 1.0) * wave;
                growth = -0.06;
                break;

            case "revenue_deterioration":
                // SIGNATURE: gross slides hard below 60% of brand average and keeps
                // falling for the last 3 periods; growth deeply negative.
                double decay = fromLatest switch { 0 => 0.40, 1 => 0.44, 2 => 0.48, _ => 0.74 - 0.01 * i };
                gross = econ.GrossBase * decay * wave;
                growth = fromLatest <= 2 ? -0.22 + 0.02 * fromLatest : -0.06;
                nps = (int)Math.Round(Lerp(51, 53) + 2 * Math.Sin(i)); // above the NPS line — revenue is the story
                fill = 0.62 * wave;
                break;

            case "no_show_spike":
                // SIGNATURE: measured no-shows spike the last 2 periods (≈0.21 vs
                // ~0.06); lost jobs sag fill + revenue with them.
                noShowV = fromLatest switch { 0 => 0.22, 1 => 0.18, _ => 0.06 + 0.01 * Math.Sin(i) };
                fill = (fromLatest <= 1 ? 0.60 : Lerp(0.72 * 0.82, 0.72)) * wave;
                gross = econ.GrossBase * 0.66 * Lerp(0.85, 1.0) * wave;
                nps = (int)Math.Round(Lerp(50, 53) + 2 * Math.Sin(i));
                growth = -0.06;
                break;

            case "royalty_late":
                // NOT broadly weak — a perfectly healthy territory whose ONLY
                // problem is the missing CURRENT-cycle financial report (handled at
                // the call site → financial_score null, status pending). On the map
                // it reads as pending/amber, a distinct provenance story, not red.
                fill = Lerp(0.80 * 0.82, 0.80) * wave;
                nps = (int)Math.Round(Lerp(58, 63) + 2 * Math.Sin(i));
                growth = 0.04;
                gross = econ.GrossBase * 1.05 * Lerp(0.80, 1.0) * wave;
                break;
        }

        return new Metrics(
            Fill: Math.Clamp(fill, 0.30, 0.99),
            NoShow: Math.Clamp(noShowV, 0.0, 0.35),
            Nps: Math.Clamp(nps, 5, 95),
            Gross: Math.Max(0, gross),
            Growth: growth,
            GoogleRating: Math.Clamp(ratingV, 3.2, 5.0),
            Quote: Math.Clamp(quoteV, 0.10, 0.65));
    }

    // period index 0..Months-1 → (periodId, start, end), ending at LatestPeriodId.
    private static (int periodId, DateTime start, DateTime end) PeriodAt(int i)
    {
        int latestY = LatestPeriodId / 100, latestM = LatestPeriodId % 100;
        var latestStart = new DateTime(latestY, latestM, 1);
        var start = latestStart.AddMonths(-(Months - 1 - i));
        var end = start.AddMonths(1).AddDays(-1);
        return (start.Year * 100 + start.Month, start, end);
    }

    // Operational plane (main's model): every brand gets an irvine + tustin
    // FRANCHISEE — same brand, two franchisees, fully isolated — each with a
    // territory and four open future slots. This backs the booking demo and the
    // franchisee-isolation tests (budget-blinds-irvine must not see -tustin).
    // These franchisees are NOT in the dashboard set (RegionId null, Num 0).
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

    // Lowercase, hyphenate non-alphanumerics, trim — "Pacific Shade Partners LLC"
    // → "pacific-shade-partners-llc". Operator names are distinct, so are slugs.
    private static string Slugify(string s)
    {
        var sb = new StringBuilder(s.Length);
        bool lastDash = false;
        foreach (char c in s.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(c)) { sb.Append(c); lastDash = false; }
            else if (!lastDash) { sb.Append('-'); lastDash = true; }
        }
        return sb.ToString().Trim('-');
    }
}
