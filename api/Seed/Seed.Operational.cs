namespace HfcDemo;

// Operational plane (main's model): every brand gets an irvine + tustin
// FRANCHISEE — same brand, two franchisees, fully isolated — each with a
// territory and four open future slots. This backs the booking demo and the
// franchisee-isolation tests (budget-blinds-irvine must not see -tustin).
// These franchisees are NOT in the dashboard set (RegionId null, Num 0), so
// they are EXCLUDED from the corporate/exec read model — enriching them here
// CANNOT move any corporate number.
//
// Enrichment (feat/seed-operator-data): the operator dashboard (/dashboard,
// see api/Dashboard/DashboardReadModel.cs) derives every tile from raw
// Appointment/Slot rows in a date window (WTD/MTD/QTD/YTD). With only 4 empty
// future slots these dashboards were ALL ZEROS. So alongside the kept future
// slots we seed believable historical + current operational activity per
// franchisee — booked Slots + Appointments with deposits — spread across the
// last ~12 months AND the current week/month, deterministically varied per
// brand so each operator dashboard differs. Mirrors the current-period style of
// SeedDashboardTerritories in Seed.Dashboard.cs.
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
        var today = DateTime.UtcNow.Date;
        int territoryId = OperationalTerritoryBase;
        int slotId = OperationalSlotBase;

        // Shared monotonic counters for the enrichment rows so DepositKey is
        // globally unique and Slot ids never collide with the kept future slots.
        int apptCounter = 0;

        // brand loop index drives all per-franchisee variation (deterministic).
        int brandIdx = 0;
        foreach (var (brandId, brandName, _, _, _, _) in Brands)
        {
            var econ = Econ.TryGetValue(brandId, out var e)
                ? e
                : new BrandEcon(14, 1500, 50_000, "Service");

            int regionIdx = 0;
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

                // ── Per-franchisee deterministic profile ──────────────────────
                // A stable seed unique to this franchisee (brand index + region).
                int profile = brandIdx * 2 + regionIdx;
                // monthly bookings ~6..14; deposit conversion ~0.55..0.85.
                int monthly = 6 + (profile % 9);                 // 6..14
                double convRate = 0.55 + (profile % 7) * 0.05;   // 0.55..0.85
                // deposit cents vary 5000..20000 per franchisee (stable band).
                int depositCents = 5000 + (profile % 4) * 5000;  // 5000,10000,15000,20000

                // ── 12 months of history + the current month-so-far ───────────
                // monthOffset 0 = current month (in progress), 1..12 = past months.
                for (int monthOffset = 0; monthOffset <= 12; monthOffset++)
                {
                    var monthAnchor = new DateTime(today.Year, today.Month, 1).AddMonths(-monthOffset);
                    // For the current month, only spread across the days so far so
                    // the WTD window (which sits inside this month) also lights up.
                    bool isCurrentMonth = monthOffset == 0;
                    int daysSoFar = isCurrentMonth
                        ? (today - monthAnchor).Days + 1
                        : DateTime.DaysInMonth(monthAnchor.Year, monthAnchor.Month);

                    // Slight monthly variation so trend/sparklines aren't flat,
                    // deterministic via the month index.
                    int monthBookings = Math.Max(4, monthly + ((monthOffset + profile) % 5) - 2);

                    for (int b = 0; b < monthBookings; b++)
                    {
                        // Spread bookings across the month's available days. For the
                        // current month, bias the LAST few into the current week so
                        // WTD is never empty.
                        int dayOfMonth;
                        if (isCurrentMonth)
                        {
                            // Put roughly the final third of this month's bookings
                            // into the last 7 days (the current week window).
                            bool inCurrentWeek = b >= (monthBookings * 2) / 3;
                            int span = inCurrentWeek ? Math.Min(7, daysSoFar) : daysSoFar;
                            int startDay = inCurrentWeek ? Math.Max(0, daysSoFar - span) : 0;
                            dayOfMonth = startDay + (span > 0 ? (b * 3 + profile) % span : 0);
                        }
                        else
                        {
                            dayOfMonth = (b * 3 + profile) % daysSoFar;
                        }

                        var start = monthAnchor.AddDays(dayOfMonth).AddHours(9 + (b % 6));

                        // Booked slot backing this appointment (fill < 100% because
                        // we add open slots below).
                        int bookedSlotId = slotId++;
                        db.Slots.Add(new Slot
                        {
                            Id = bookedSlotId, FranchiseeId = franchiseeId, BrandId = brandId,
                            TerritoryId = te.Id, StartUtc = start, IsBooked = true, Version = 0,
                        });

                        // Deterministic deposit/leak decision: each appointment gets a
                        // stable 0..99 "roll" from (month, booking-index, profile); it
                        // is paid when the roll clears convRate, else it's a leak (no
                        // deposit). The roll is DECOUPLED from seed order on purpose —
                        // the leak fraction lands in EVERY month, so the operator
                        // dashboard's WTD/MTD/QTD/YTD windows all show a realistic
                        // conversion, never a degenerate 0% or 100%.
                        //   Bug before: `(b % 100) < convRate*100`, where `b` is the
                        //   per-month index (0..~14) and never reaches convRate*100
                        //   (55..85), marked EVERY booking paid → 100% conversion,
                        //   zero leaks, zero expired across all 8 brands.
                        int roll = (monthOffset * 17 + b * 31 + profile * 7) % 100;
                        bool paid = roll < (int)Math.Round(convRate * 100);
                        bool past = start < DateTime.UtcNow;

                        apptCounter++;
                        var appt = new Appointment
                        {
                            FranchiseeId = franchiseeId, BrandId = brandId,
                            TerritoryId = te.Id, SlotId = bookedSlotId,
                            StartUtc = start,
                            CustomerName = $"Customer {franchiseeId}-{monthOffset}-{b}",
                            Service = econ.Service,
                        };

                        if (paid)
                        {
                            // small variation in deposit cents per appointment.
                            appt.DepositCents = depositCents + (b % 3) * 1000;
                            appt.DepositKey = $"seed-dep-{apptCounter}";
                            if (past)
                            {
                                // Finalized job → completed + plausible invoice.
                                appt.Status = "completed";
                                appt.InvoiceCents = (int)(econ.TicketUsd * 100);
                            }
                            else
                            {
                                appt.Status = "scheduled";
                            }
                        }
                        else
                        {
                            // Leak: no deposit. Past + unpaid → Expired/abandoned.
                            appt.DepositKey = null;
                            appt.Status = "scheduled";
                        }
                        db.Appointments.Add(appt);
                    }

                    // ── Open slots so fill rate is ~70–85%, not 100% ──────────
                    // Add unbooked slots in the same month window proportional to
                    // bookings (≈ 1 open per ~4 booked → ~80% fill).
                    int openInMonth = Math.Max(1, monthBookings / 4);
                    for (int o = 0; o < openInMonth; o++)
                    {
                        int openDay = (o * 5 + profile + 1) % Math.Max(1, daysSoFar);
                        db.Slots.Add(new Slot
                        {
                            Id = slotId++, FranchiseeId = franchiseeId, BrandId = brandId,
                            TerritoryId = te.Id,
                            StartUtc = monthAnchor.AddDays(openDay).AddHours(13 + (o % 4)),
                            IsBooked = false, Version = 0,
                        });
                    }
                }

                // ── KEEP the existing 4 future open slots ─────────────────────
                // The booking/isolation demo depends on these exact unbooked
                // future slots (territory ids 5001+, slot ids 800000+ region).
                for (int d = 0; d < 2; d++)
                    for (int h = 0; h < 2; h++)
                        db.Slots.Add(new Slot
                        {
                            Id = slotId++, FranchiseeId = franchiseeId, BrandId = brandId,
                            TerritoryId = te.Id,
                            StartUtc = baseDay.AddDays(d).AddHours(h * 3),
                            IsBooked = false, Version = 0,
                        });

                regionIdx++;
            }

            brandIdx++;
        }
    }
}
