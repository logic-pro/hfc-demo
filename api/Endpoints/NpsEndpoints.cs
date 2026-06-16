using Microsoft.EntityFrameworkCore;

namespace HfcDemo;

// ── Post-service NPS ─────────────────────────────────────────────────────────
// The row the dashboards read — the source of truth that flips NPS from seeded to
// measured (the Durable NpsWorkflow's review-gen runs off the same score). One
// survey per appointment; a second response for the same appointment is a conflict.
// Tenant-scoped by FranchiseeId, with TerritoryId denormalized so the dashboard can
// aggregate to territory grain without a join.
public static class NpsEndpoints
{
    public static void MapNps(this WebApplication app)
    {
        // Record a post-service NPS response.
        app.MapPost("/api/appointments/{id:int}/nps",
            async (int id, NpsRequest req, AppDb db) =>
        {
            // score is REQUIRED: an omitted score now binds to null (not 0), so we
            // reject it instead of silently recording a 0/10. Then keep the range check.
            if (req.Score is null)
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["score"] = new[] { "score is required." },
                });
            if (req.Score is < 0 or > 10)
                return Results.Problem(statusCode: 400, title: "NPS score must be 0–10.");

            // Read the appointment through the tenant filter: a survey can only be
            // recorded against the current franchisee's own appointment (else 404,
            // never cross-tenant). FranchiseeId/BrandId/TerritoryId are copied from it,
            // not from client input, so the survey inherits the appointment's isolation
            // boundary and dashboard grain exactly.
            var appt = await db.Appointments.FirstOrDefaultAsync(a => a.Id == id);
            if (appt is null) return Results.NotFound();

            if (await db.NpsSurveys.AnyAsync(s => s.AppointmentId == id))
                return Results.Conflict("NPS already recorded for this appointment.");

            var survey = new NpsSurvey
            {
                FranchiseeId = appt.FranchiseeId,   // isolation key — inherited from the appointment
                BrandId = appt.BrandId,             // grouping (denormalized)
                TerritoryId = appt.TerritoryId,     // denormalize for territory-level aggregation
                AppointmentId = appt.Id,
                Score = req.Score.Value,
                Comment = req.Comment ?? "",
                RespondedAt = DateTime.UtcNow,
            };
            db.NpsSurveys.Add(survey);
            try
            {
                await db.SaveChangesAsync();
            }
            catch (DbUpdateException)              // unique-index race: two responses at once
            {
                return Results.Conflict("NPS already recorded for this appointment.");
            }
            return Results.Created($"/api/appointments/{appt.Id}/nps",
                new NpsSurveyDto(survey.Id, survey.AppointmentId, survey.TerritoryId,
                    survey.Score, survey.Comment, survey.RespondedAt));
        }).RequireAuthorization();

        // All NPS responses for the current tenant — the dashboards' measured-NPS feed.
        // Tenant-filtered (by FranchiseeId), territory-resolvable without a join: the
        // dashboard groups this by the denormalized TerritoryId to flip its NPS tile
        // from seeded to measured.
        app.MapGet("/api/nps", async (AppDb db) =>
        {
            var surveys = await db.NpsSurveys.OrderBy(s => s.RespondedAt)
                .Select(s => new NpsSurveyDto(s.Id, s.AppointmentId, s.TerritoryId,
                    s.Score, s.Comment, s.RespondedAt))
                .ToListAsync();
            return Results.Ok(surveys);
        }).RequireAuthorization();
    }
}
