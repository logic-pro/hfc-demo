namespace HfcDemo;

// ── AI-assisted structured intake ────────────────────────────────────────────
// Turn the customer's free-text request into a TYPED draft the agent can review
// and edit before booking. Tenant-scoped so the extractor maps onto the current
// brand's service vocabulary. Spend/latency are capped inside the service, and any
// failure degrades to a local heuristic — so this endpoint always returns a usable
// draft (never 5xx on a model hiccup).
public static class IntakeEndpoints
{
    public static void MapIntake(this WebApplication app)
    {
        app.MapPost("/api/intake/parse", async (IntakeRequest req, IntakeService intake, TenantContext t, CancellationToken ct) =>
        {
            var draft = await intake.ParseAsync(req.Text, t.BrandId, ct);
            return Results.Ok(draft);
        }).RequireAuthorization();
    }
}
