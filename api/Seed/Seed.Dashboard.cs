using Microsoft.EntityFrameworkCore;

namespace HfcDemo;

// Dashboard plane — named franchisees (data controllers), 49 territories with a
// tenure spread and ~18 months of measured + reported history. The metric
// trajectories (including the four red stories) live here.
public static partial class Seed
{
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

            // ── Current in-progress month: seed measured activity so the operator
            // dashboard's WTD/MTD filters aren't empty (the historical rows above all
            // end at LatestPeriodId / May). These rows have NO MonthlyReport, so
            // RecomputeRollup (report-driven) ignores them — they power ONLY the
            // franchisee's live date-window query, never the corporate roll-up.
            // Seed EVERY day of the month-so-far (incl. today + the current week) so
            // BOTH the WTD and MTD filters are alive.
            var today = DateTime.UtcNow.Date;
            var monthStart0 = new DateTime(today.Year, today.Month, 1);
            int daysSoFar = (today - monthStart0).Days + 1;
            var cm = Trajectory(p, econ, Months - 1, 1.0, 1.0);   // latest-period quality mix
            int perDay = Math.Max(2, econ.Capacity / 12);
            for (int dayOffset = 0; dayOffset < daysSoFar; dayOffset++)
            {
                var day = monthStart0.AddDays(dayOffset);
                int dBooked = Math.Max(1, (int)Math.Round(perDay * cm.Fill)); // >=1 booked/day so WTD is never empty
                int dNoShow = (int)Math.Round(dBooked * cm.NoShow);
                for (int s = 0; s < perDay; s++)
                {
                    var start = day.AddHours(9 + s * 3);
                    bool isBooked = s < dBooked;
                    db.Slots.Add(new Slot
                    {
                        Id = slotId, FranchiseeId = franchiseeId, BrandId = p.Brand,
                        TerritoryId = p.Id, StartUtc = start, IsBooked = isBooked, Version = 0,
                    });
                    if (isBooked)
                    {
                        string status = s < (dBooked - dNoShow) ? "completed" : "no_show";
                        db.Appointments.Add(new Appointment
                        {
                            FranchiseeId = franchiseeId, BrandId = p.Brand,
                            TerritoryId = p.Id, SlotId = slotId,
                            StartUtc = start, CustomerName = $"Customer {p.Id}-cur-{dayOffset}-{s}",
                            Service = econ.Service, Status = status,
                            InvoiceCents = status == "completed" ? (int)(econ.TicketUsd * 100) : 0,
                        });
                    }
                    slotId++;
                }
            }
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

    // ── Measured NPS plane (ADR-20) ───────────────────────────────────────────
    // Seed real NpsSurvey rows for a HANDFUL of dashboard territories spanning the
    // three dashboard brands, so RecomputeRollup derives a MEASURED nps for them
    // and the dashboard flips those from "Illustrative" to "Measured" — with no
    // DTO change. Every OTHER territory has no survey rows and keeps its seeded
    // (illustrative) value, so the provenance split is honest. Surveys are tied to
    // real completed appointments (AppointmentId is uniquely indexed) and scored to
    // match each territory's seeded tier, so health scores and the watchlist are
    // unchanged — only the provenance label flips.
    private static void SeedDashboardNpsSurveys(AppDb db)
    {
        // (territoryId, targetNps): non-at-risk territories, two per dashboard brand.
        // Targets mirror each one's seeded latest NPS (star≈80, healthy≈58) and stay
        // above the 50 watchlist line so the only NPS story remains Atlanta's collapse.
        var measured = new[]
        {
            (Terr:  1, Target: 80), (Terr:  3, Target: 58),  // Budget Blinds: Orange County North, Denver Metro
            (Terr:  9, Target: 80), (Terr: 13, Target: 58),  // Two Maids: San Diego Coast, Nashville
            (Terr: 18, Target: 80), (Terr: 21, Target: 58),  // Lightspeed: Bay Area East, Charleston
        };

        foreach (var (terr, target) in measured)
        {
            // Cross-tenant read (the seed has no tenant context, like RecomputeRollup):
            // a recent sample of real completed appointments to attach responses to.
            var appts = db.Appointments.IgnoreQueryFilters()
                .Where(a => a.TerritoryId == terr && a.Status == "completed")
                .OrderByDescending(a => a.StartUtc)
                .Take(20)
                .ToList();
            if (appts.Count == 0) continue;

            // Deterministic 0–10 mix whose %promoters−%detractors ≈ target: a few
            // detractors, enough promoters to clear the target, the rest passive.
            int n = appts.Count;
            int detr = (int)Math.Round(n * 0.08);
            int prom = Math.Clamp((int)Math.Round(detr + target * n / 100.0), 0, n);
            for (int k = 0; k < n; k++)
            {
                var a = appts[k];
                int score = k < prom ? (k % 2 == 0 ? 10 : 9)   // promoter (9–10)
                          : k < prom + detr ? 4 + (k % 3)       // detractor (4–6)
                          : 7 + (k % 2);                        // passive (7–8)
                db.NpsSurveys.Add(new NpsSurvey
                {
                    FranchiseeId = a.FranchiseeId, BrandId = a.BrandId,
                    TerritoryId = a.TerritoryId, AppointmentId = a.Id,
                    Score = score, Comment = "",
                    RespondedAt = a.StartUtc.AddDays(1),
                });
            }
        }
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
}
