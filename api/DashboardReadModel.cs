using Microsoft.EntityFrameworkCore;

namespace HfcDemo;

// ─────────────────────────────────────────────────────────────────────────────
// Franchisee Operations read-model.  The SPA never aggregates raw rows: this
// builder returns the pre-shaped DashboardResponse (see web/.../API-CONTRACT.md
// and dashboard.models.ts — the C# records below mirror that wire contract).
//
// Tenancy: every query here runs through AppDb, which applies the global
// BrandId query filter, so each aggregate is scoped to the franchisee. No
// client-supplied tenant is trusted.
//
// Funnel ⇄ Durable workflow mapping.  The Durable orchestration (BookingWorkflow)
// runs in a *separate* process and only logs its states — it does not persist
// Reminded/Finalized/Expired back to this DB.  So the read model derives the
// funnel from the columns we *do* have, deterministically:
//   Booked      = appointment exists
//   Reminded    = reminder fires shortly after confirm for every booking, so it
//                 mirrors Booked (we don't persist a per-appointment reminder
//                 flag → conversion shows 1.00, and that's the honest number)
//   DepositPaid = DepositKey is set (deposit captured, idempotent)
//   Finalized   = deposit captured AND the slot time has passed (job done)
//   Expired     = no deposit AND the slot time has passed — the recoverable leak
// Everything is dataQuality:"measured"; job revenue is explicitly unavailable.
// ─────────────────────────────────────────────────────────────────────────────

public static class PeriodRange
{
    // The documented operator period set (web/.../API-CONTRACT.md): WTD|MTD|QTD|YTD.
    // LTM is NOT in the contract — it was silently falling back to MTD; it (and any
    // other token) is now genuinely invalid and rejected by the endpoint with 400.
    private static readonly HashSet<string> Valid =
        new(StringComparer.OrdinalIgnoreCase) { "WTD", "MTD", "QTD", "YTD" };

    public static bool IsValid(string? period) =>
        period is null || Valid.Contains(period);

    public static (DateTime Start, DateTime End, string Label, DateTime PriorStart, DateTime PriorEnd)
        For(string period, DateTime now)
    {
        DateTime start, end;
        string label;
        switch ((period ?? "MTD").ToUpperInvariant())
        {
            case "WTD":
                start = now.Date.AddDays(-(int)now.DayOfWeek); // week starts Sunday
                end = start.AddDays(7);
                label = "This week";
                break;
            case "QTD":
                var q = (now.Month - 1) / 3;
                start = new DateTime(now.Year, q * 3 + 1, 1, 0, 0, 0, DateTimeKind.Utc);
                end = start.AddMonths(3);
                label = "This quarter";
                break;
            case "YTD":
                start = new DateTime(now.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                end = start.AddYears(1);
                label = "This year";
                break;
            case "MTD":
            default:
                start = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
                end = start.AddMonths(1);
                label = "This month";
                break;
        }
        // Comparison = the equal-length window immediately before this period.
        var len = end - start;
        return (start, end, label, start - len, start);
    }
}

public static class DashboardReadModel
{
    private const string RevenueReason =
        "Job revenue is not captured in this system. Showing deposit volume only.";

    public static async Task<DashboardResponse> BuildAsync(
        AppDb db, TenantContext t, string period, int? territoryId, DateTime now)
    {
        var r = PeriodRange.For(period, now);

        // Tenant-scoped by the EF global query filter.
        var territories = await db.Territories
            .OrderBy(x => x.Name)
            .Select(x => new { x.Id, x.Name })
            .ToListAsync();
        var nameById = territories.ToDictionary(x => x.Id, x => x.Name);

        IQueryable<Appointment> apptQ = db.Appointments;
        IQueryable<Slot> slotQ = db.Slots;
        if (territoryId is int tid)
        {
            apptQ = apptQ.Where(a => a.TerritoryId == tid);
            slotQ = slotQ.Where(s => s.TerritoryId == tid);
        }

        // Pull the two windows once each; aggregate in memory (small demo volumes,
        // and it sidesteps SQLite date-function translation quirks).
        var current = await apptQ.Where(a => a.StartUtc >= r.Start && a.StartUtc < r.End).ToListAsync();
        var prior = await apptQ.Where(a => a.StartUtc >= r.PriorStart && a.StartUtc < r.PriorEnd).ToListAsync();
        var slots = await slotQ.Where(s => s.StartUtc >= r.Start && s.StartUtc < r.End).ToListAsync();
        var priorSlots = await slotQ.Where(s => s.StartUtc >= r.PriorStart && s.StartUtc < r.PriorEnd).ToListAsync();

        var cur = Metrics.From(current, slots, now);
        var prv = Metrics.From(prior, priorSlots, now);

        var kpis = BuildKpis(cur, prv, current, now, r.Start, r.End);
        var trend = BuildTrend(current, slots, now, r.Start, r.End);
        var funnel = BuildFunnel(cur);
        var breakdown = BuildBreakdown(current, slots, nameById, now);
        var actions = BuildActions(current, nameById, now);

        return new DashboardResponse(
            Period: new DashPeriodDto(
                (period ?? "MTD").ToUpperInvariant(), r.Label, Iso(r.Start), Iso(r.End)),
            LastUpdated: Iso(now),
            Territory: territoryId is int id && nameById.TryGetValue(id, out var nm)
                ? new TerritoryRef(id, nm) : null,
            Kpis: kpis,
            BookingTrend: trend,
            DepositFunnel: funnel,
            TerritoryBreakdown: breakdown,
            ActionRows: actions,
            Revenue: new RevenueDto(false, RevenueReason));
    }

    // ── KPI tiles ────────────────────────────────────────────────────────────
    private static IReadOnlyList<KpiDto> BuildKpis(
        Metrics cur, Metrics prv, List<Appointment> current, DateTime now, DateTime start, DateTime end)
    {
        var trendDays = DayBuckets(start, end, now);

        double[] series(Func<List<Appointment>, double> f) =>
            trendDays.Select(d => f(current.Where(a => a.StartUtc.Date == d).ToList())).ToArray();

        return new List<KpiDto>
        {
            new("bookings", "Bookings", cur.Bookings, "count",
                Delta(cur.Bookings, prv.Bookings),
                series(a => a.Count), cur.Bookings > 0 ? "good" : "neutral",
                "measured", true, "all",
                "Appointments booked in the selected period."),

            new("slot_fill_rate", "Slot fill rate", cur.FillRate, "percent",
                Delta(cur.FillRate, prv.FillRate),
                series(a => a.Count), // booked-appointments-per-day proxy for the sparkline
                Band(cur.FillRate, 0.75, 0.50), "measured", true, "open_slots",
                "Filled slots ÷ available slots. Low fill = unused crew capacity."),

            new("deposit_conversion", "Deposit conversion", cur.DepositConversion, "percent",
                Delta(cur.DepositConversion, prv.DepositConversion),
                series(a => a.Count(x => x.DepositKey != null)),
                Band(cur.DepositConversion, 0.65, 0.50), "measured", true, "deposit_unpaid",
                "Booked appointments that paid a deposit. Falling = revenue at risk."),

            new("deposit_volume", "Deposit volume", cur.DepositVolumeCents, "currency_cents",
                Delta(cur.DepositVolumeCents, prv.DepositVolumeCents),
                series(a => a.Where(x => x.DepositKey != null).Sum(x => (double)x.DepositCents)),
                "neutral", "measured", true, "deposit_paid",
                "Total DEPOSITS captured — not job revenue. Job revenue is not in the system."),

            new("expired_abandoned", "Expired / abandoned", cur.Expired, "count",
                Delta(cur.Expired, prv.Expired),
                series(a => a.Count(x => x.DepositKey == null && x.StartUtc < now)),
                cur.Expired == 0 ? "good" : cur.Expired <= 3 ? "warning" : "bad",
                "measured", false, "expired",
                "Bookings that expired without a deposit (the workflow leak)."),
        };
    }

    // ── booking / fill trend (per day) ─────────────────────────────────────────
    private static IReadOnlyList<TrendPointDto> BuildTrend(
        List<Appointment> current, List<Slot> slots, DateTime now, DateTime start, DateTime end)
    {
        return DayBuckets(start, end, now).Select(d =>
        {
            var daySlots = slots.Where(s => s.StartUtc.Date == d).ToList();
            return new TrendPointDto(
                Iso(d),
                current.Count(a => a.StartUtc.Date == d),
                daySlots.Count(s => s.IsBooked),
                daySlots.Count(s => !s.IsBooked));
        }).ToList();
    }

    // ── deposit funnel (mirrors the workflow) ──────────────────────────────────
    private static IReadOnlyList<FunnelStageDto> BuildFunnel(Metrics m)
    {
        double? conv(int n, int prev) => prev > 0 ? (double)n / prev : (double?)null;
        return new List<FunnelStageDto>
        {
            new("Booked", m.Bookings, null, false, "all"),
            new("Reminded", m.Bookings, conv(m.Bookings, m.Bookings), false, "all"),
            new("DepositPaid", m.Paid, conv(m.Paid, m.Bookings), false, "deposit_paid"),
            new("Finalized", m.Finalized, conv(m.Finalized, m.Paid), false, "deposit_paid"),
            new("Expired", m.Expired, null, true, "expired"),
        };
    }

    // ── per-territory breakdown ────────────────────────────────────────────────
    private static IReadOnlyList<TerritoryRowDto> BuildBreakdown(
        List<Appointment> current, List<Slot> slots, Dictionary<int, string> nameById, DateTime now)
    {
        return current
            .GroupBy(a => a.TerritoryId)
            .Select(g =>
            {
                var m = Metrics.From(g.ToList(), slots.Where(s => s.TerritoryId == g.Key).ToList(), now);
                return new TerritoryRowDto(
                    g.Key,
                    nameById.TryGetValue(g.Key, out var n) ? n : $"Territory {g.Key}",
                    m.Bookings, m.FillRate, m.DepositConversion, m.NeedsAction);
            })
            .OrderByDescending(x => x.NeedsActionCount)
            .ThenByDescending(x => x.Bookings)
            .ToList();
    }

    // ── action table (appointments needing follow-up, pre-ranked) ──────────────
    private static IReadOnlyList<DashActionRowDto> BuildActions(
        List<Appointment> current, Dictionary<int, string> nameById, DateTime now)
    {
        int rank(string sev) => sev == "bad" ? 0 : sev == "warning" ? 1 : 2;

        return current
            .Select(a => Classify(a, nameById, now))
            .Where(a => a is not null)
            .Select(a => a!)
            .OrderBy(a => rank(a.Severity))
            .ThenBy(a => a.StartUtc)
            .Take(30)
            .ToList();
    }

    private static DashActionRowDto? Classify(
        Appointment a, Dictionary<int, string> nameById, DateTime now)
    {
        var paid = a.DepositKey != null;
        var past = a.StartUtc < now;
        var name = nameById.TryGetValue(a.TerritoryId, out var n) ? n : $"Territory {a.TerritoryId}";

        string stage, action, severity;
        if (paid && past) return null;                 // Finalized — nothing to do
        if (paid)                                       // DepositPaid, upcoming
        {
            stage = "DepositPaid"; severity = "neutral";
            action = "Confirm crew assignment for finalization";
        }
        else if (past)                                  // Expired — the leak
        {
            stage = "Expired"; severity = "bad";
            action = "Re-offer slot — booking expired without a deposit";
        }
        else                                            // Reminded, unpaid, upcoming
        {
            var soon = a.StartUtc <= now.AddHours(48);
            stage = "Reminded"; severity = soon ? "bad" : "warning";
            action = soon
                ? "Send deposit link — appointment soon, still unpaid"
                : "Send deposit link — reminded, awaiting deposit";
        }

        return new DashActionRowDto(
            a.Id, a.CustomerName, a.TerritoryId, name, Iso(a.StartUtc), a.Service,
            a.DepositCents, paid, stage, action, severity);
    }

    // ── helpers ────────────────────────────────────────────────────────────────
    /// Up to 14 daily buckets ending at `now`, clamped to the period — enough for
    /// a sparkline / trend without exploding for QTD/YTD.
    private static List<DateTime> DayBuckets(DateTime start, DateTime end, DateTime now)
    {
        var last = (now < end ? now : end).Date;
        var first = last.AddDays(-13);
        if (first < start.Date) first = start.Date;
        var days = new List<DateTime>();
        for (var d = first; d <= last; d = d.AddDays(1)) days.Add(d);
        return days;
    }

    private static double? Delta(double cur, double prior) =>
        prior > 0 ? (cur - prior) / prior : (double?)null;

    private static string Band(double v, double good, double warn) =>
        v >= good ? "good" : v >= warn ? "warning" : "bad";

    private static string Iso(DateTime d) =>
        DateTime.SpecifyKind(d, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ssZ");

    // Aggregate over one window.
    private readonly struct Metrics
    {
        public int Bookings { get; init; }
        public int Paid { get; init; }
        public int Expired { get; init; }
        public int Finalized { get; init; }
        public int NeedsAction { get; init; }
        public double DepositVolumeCents { get; init; }
        public double FillRate { get; init; }
        public double DepositConversion => Bookings > 0 ? (double)Paid / Bookings : 0;

        public static Metrics From(List<Appointment> appts, List<Slot> slots, DateTime now)
        {
            int paid = appts.Count(a => a.DepositKey != null);
            int expired = appts.Count(a => a.DepositKey == null && a.StartUtc < now);
            int finalized = appts.Count(a => a.DepositKey != null && a.StartUtc < now);
            return new Metrics
            {
                Bookings = appts.Count,
                Paid = paid,
                Expired = expired,
                Finalized = finalized,
                // follow-up backlog = anything unpaid (reminded + expired)
                NeedsAction = appts.Count(a => a.DepositKey == null),
                DepositVolumeCents = appts.Where(a => a.DepositKey != null).Sum(a => (double)a.DepositCents),
                FillRate = slots.Count > 0 ? (double)slots.Count(s => s.IsBooked) / slots.Count : 0,
            };
        }
    }
}

// ── wire DTOs (camelCased by the Web JSON defaults → match dashboard.models.ts) ─
public record DashPeriodDto(string Type, string Label, string Start, string End);
public record TerritoryRef(int Id, string Name);
public record KpiDto(
    string Key, string Label, double? Value, string Unit, double? DeltaPercent,
    double[] Trend, string Status, string DataQuality, bool HigherIsBetter,
    string DrillTo, string Tooltip);
public record TrendPointDto(string Date, int Bookings, int FilledSlots, int OpenSlots);
public record FunnelStageDto(string Stage, int Count, double? ConversionFromPrev, bool IsLeak, string DrillTo);
public record TerritoryRowDto(
    int TerritoryId, string TerritoryName, int Bookings, double FillRate,
    double DepositConversion, int NeedsActionCount);
public record DashActionRowDto(
    int AppointmentId, string CustomerName, int TerritoryId, string TerritoryName,
    string StartUtc, string Service, int DepositCents, bool DepositPaid,
    string Stage, string RecommendedAction, string Severity);
public record RevenueDto(bool Available, string Reason);
public record DashboardResponse(
    DashPeriodDto Period, string LastUpdated, TerritoryRef? Territory,
    IReadOnlyList<KpiDto> Kpis, IReadOnlyList<TrendPointDto> BookingTrend,
    IReadOnlyList<FunnelStageDto> DepositFunnel, IReadOnlyList<TerritoryRowDto> TerritoryBreakdown,
    IReadOnlyList<DashActionRowDto> ActionRows, RevenueDto Revenue);
