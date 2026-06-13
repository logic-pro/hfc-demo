namespace HfcDemo;

// Seeds the 8 real HFC brands plus a couple of territories and open slots each,
// so the demo has tenant-isolated data the moment it boots. Idempotent: skips
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
        var created = new List<Territory>();
        foreach (var (id, _, _) in Brands)
        {
            // two territories per brand
            foreach (var city in new[] { "Irvine, CA", "Tustin, CA" })
            {
                var te = new Territory { Id = territoryId++, BrandId = id, Name = $"{city} Crew", City = city };
                db.Territories.Add(te);
                created.Add(te);
                // four open slots over the next two days (the booking demo books these)
                for (int d = 0; d < 2; d++)
                    for (int h = 0; h < 2; h++)
                        db.Slots.Add(new Slot
                        {
                            BrandId = id,
                            TerritoryId = te.Id,
                            StartUtc = baseDay.AddDays(d).AddHours(h * 3),
                            IsBooked = false,
                            Version = 0,
                        });
            }
        }
        db.SaveChanges();

        SeedDashboardHistory(db, created);
    }

    // ── Dashboard demo data (Slice D) ─────────────────────────────────────────
    // The Durable workflow doesn't persist its states back to this DB, so the
    // dashboard read-model derives the funnel from (DepositKey set?) + (StartUtc
    // past?). We seed a deliberate mix per territory — solid demand, a visible
    // deposit leak (unpaid expirations + upcoming unpaid) — so the funnel and
    // action table have something real to point at. These ride on their own
    // booked history slots, leaving the open future slots above for the booking
    // demo untouched.
    private static void SeedDashboardHistory(AppDb db, List<Territory> territories)
    {
        var now = DateTime.UtcNow;

        // (dayOffset, paid, depositCents, service, customer)
        var plan = new (int Day, bool Paid, int Cents, string Service, string Customer)[]
        {
            (-22, true, 7500,  "In-home consult",  "Maria Gomez"),
            (-18, true, 5000,  "Window estimate",  "Derek Liu"),
            (-15, false, 0,    "In-home consult",  "Priya Nair"),    // expired (leak)
            (-11, true, 12000, "Closet design",    "Tom Becker"),
            (-8,  false, 0,    "Garage cabinets",  "Sara Webb"),     // expired (leak)
            (-5,  true, 6000,  "Cabinet refacing", "Andre Cole"),
            (-2,  true, 9000,  "Bath update",      "Lena Park"),
            (0,   false, 0,    "In-home consult",  "Omar Haddad"),   // unpaid, today
            (1,   false, 0,    "Window estimate",  "Jade Wilson"),   // reminded, upcoming
            (1,   true, 8000,  "Closet design",    "Nina Alvarez"),  // deposit paid, upcoming
        };

        int seq = 0;
        foreach (var te in territories)
        {
            foreach (var p in plan)
            {
                seq++;
                var startUtc = now.Date.AddDays(p.Day).AddHours(9 + (seq % 6));
                // each appointment needs its own (booked) slot — SlotId is unique.
                var slot = new Slot
                {
                    BrandId = te.BrandId, TerritoryId = te.Id,
                    StartUtc = startUtc, IsBooked = true, Version = 1,
                };
                db.Slots.Add(slot);
                db.SaveChanges();                      // materialize slot.Id

                db.Appointments.Add(new Appointment
                {
                    BrandId = te.BrandId,
                    TerritoryId = te.Id,
                    SlotId = slot.Id,
                    StartUtc = startUtc,
                    CustomerName = p.Customer,
                    Service = p.Service,
                    DepositCents = p.Paid ? p.Cents : 0,
                    DepositKey = p.Paid ? $"seed-{te.Id}-{seq}" : null,
                });
            }
        }
        db.SaveChanges();
    }
}
