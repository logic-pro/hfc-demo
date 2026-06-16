using Microsoft.EntityFrameworkCore;

namespace HfcDemo;

// ── Booking lifecycle ────────────────────────────────────────────────────────
// Slots → appointments → deposit. Every handler is auth-gated and reads/writes
// through the EF global query filter, so a franchisee only ever sees and books
// its own rows. Optimistic concurrency on Slot.Version makes double-booking a 409;
// deposit is idempotent on the Idempotency-Key header so a retry never double-charges.
public static class BookingEndpoints
{
    public static void MapBooking(this WebApplication app)
    {
        // Open slots for the current tenant (resolved franchisee).
        app.MapGet("/api/slots", async (AppDb db) =>
        {
            var slots = await db.Slots
                .Join(db.Territories, s => s.TerritoryId, te => te.Id, (s, te) => new { s, te })
                .OrderBy(x => x.s.StartUtc)
                .Select(x => new SlotDto(x.s.Id, x.te.Id, x.te.Name, x.s.StartUtc, x.s.IsBooked))
                .ToListAsync();
            return Results.Ok(slots);
        }).RequireAuthorization();

        // Appointments for the current tenant.
        app.MapGet("/api/appointments", async (AppDb db) =>
        {
            var appts = await db.Appointments.OrderBy(a => a.StartUtc)
                .Select(a => new AppointmentDto(a.Id, a.TerritoryId, a.StartUtc, a.CustomerName,
                    a.Service, a.DepositCents, a.DepositKey != null))
                .ToListAsync();
            return Results.Ok(appts);
        }).RequireAuthorization();

        // Book a slot. Optimistic concurrency on Slot.Version means two racing
        // bookings can't both win — the loser gets 409. The slot is read through the
        // tenant filter, so a franchisee can only book its own slots.
        app.MapPost("/api/appointments", async (BookRequest req, AppDb db, TenantContext t) =>
        {
            // Validate required fields BEFORE the slot lookup so missing input is a
            // clean 400 — never a misleading 404/409, and never an appointment with
            // an empty customer name on an otherwise-open slot.
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(req.CustomerName))
                errors["customerName"] = new[] { "customerName is required." };
            if (string.IsNullOrWhiteSpace(req.Service))
                errors["service"] = new[] { "service is required." };
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var slot = await db.Slots.FirstOrDefaultAsync(s => s.Id == req.SlotId);
            if (slot is null) return Results.NotFound();   // not found OR not this tenant's
            if (slot.IsBooked) return Results.Conflict("Slot already booked.");

            slot.IsBooked = true;
            slot.Version++;                       // bump the concurrency token
            var appt = new Appointment
            {
                FranchiseeId = slot.FranchiseeId,
                BrandId = slot.BrandId,
                TerritoryId = slot.TerritoryId,
                SlotId = slot.Id,
                StartUtc = slot.StartUtc,
                CustomerName = req.CustomerName,
                Service = req.Service,
            };
            db.Appointments.Add(appt);
            try
            {
                await db.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)  // someone booked this slot first
            {
                return Results.Conflict("Slot was just booked by someone else.");
            }
            catch (DbUpdateException)              // unique-index race on SlotId
            {
                return Results.Conflict("Slot already booked.");
            }
            return Results.Created($"/api/appointments/{appt.Id}",
                new AppointmentDto(appt.Id, appt.TerritoryId, appt.StartUtc, appt.CustomerName,
                    appt.Service, appt.DepositCents, false));
        }).RequireAuthorization();

        // Pay a deposit. Idempotent: a retry with the same Idempotency-Key never
        // double-charges — it returns the already-applied result.
        app.MapPost("/api/appointments/{id:int}/deposit",
            async (int id, DepositRequest req, HttpRequest http, AppDb db) =>
        {
            if (!http.Headers.TryGetValue("Idempotency-Key", out var key) || string.IsNullOrWhiteSpace(key))
                return Results.Problem(statusCode: 400, title: "Missing Idempotency-Key header.");

            // Validate the amount BEFORE touching any state: a deposit must be a
            // positive amount. Reject missing/0/negative so we never persist a
            // settled-but-nonsensical deposit (e.g. depositCents:-500, depositPaid:true).
            if (req.AmountCents < 1)
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["amountCents"] = new[] { "amountCents is required and must be at least 1." },
                });

            var appt = await db.Appointments.FirstOrDefaultAsync(a => a.Id == id);
            if (appt is null) return Results.NotFound();   // not found OR not this tenant's

            if (appt.DepositKey is not null)       // already paid
            {
                // Same key => safe retry; different key => the deposit is already settled.
                return Results.Ok(new AppointmentDto(appt.Id, appt.TerritoryId, appt.StartUtc,
                    appt.CustomerName, appt.Service, appt.DepositCents, true));
            }

            appt.DepositCents = req.AmountCents;
            appt.DepositKey = key.ToString();
            await db.SaveChangesAsync();
            return Results.Ok(new AppointmentDto(appt.Id, appt.TerritoryId, appt.StartUtc,
                appt.CustomerName, appt.Service, appt.DepositCents, true));
        }).RequireAuthorization();
    }
}
