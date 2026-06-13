using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging;

namespace HfcDemo.Functions;

// Post-service NPS → review-gen as a Durable Functions orchestration on the same
// backbone as the booking lifecycle. The booking workflow proves "wait for money
// or expire"; this proves the *other* half of the human-interaction pattern —
// "ask the customer something, act on their answer, and still finish cleanly when
// they never reply."
//
// Why Durable and not a cron/queue: the gap between "service done" and "customer
// answers the survey" is hours-to-days, must survive restarts/deploys/scale-to-zero,
// and has two terminal outcomes (a drafted review, or a survey that timed out). The
// orchestrator replays from history, so that wait costs nothing while it's pending.
//
// Flow: requestNps -> await "NpsResponse" event (the 0–10 score) OR durable-timer
// timeout -> draftReview (tier the score into a review) / expire.

public record NpsInput(string BrandId, int AppointmentId, int TimeoutSeconds);

public static class NpsWorkflow
{
    // ── Orchestrator ─────────────────────────────────────────────────────────
    [Function(nameof(NpsOrchestrator))]
    public static async Task<string> NpsOrchestrator(
        [OrchestrationTrigger] TaskOrchestrationContext context)
    {
        var input = context.GetInput<NpsInput>()!;
        var log = context.CreateReplaySafeLogger(nameof(NpsOrchestrator));

        await context.CallActivityAsync(nameof(RequestNps), input);

        // Human-interaction pattern: wait for the customer's NPS response, but bound
        // it with a durable timer so an un-answered survey expires instead of leaving
        // the instance pending forever. This timeout path is the one people forget —
        // and the one that keeps a fan-out of surveys from accumulating zombies.
        using var cts = new CancellationTokenSource();
        var deadline = context.CurrentUtcDateTime.AddSeconds(input.TimeoutSeconds);
        Task timeout = context.CreateTimer(deadline, cts.Token);
        Task<int> responded = context.WaitForExternalEvent<int>("NpsResponse");

        var winner = await Task.WhenAny(responded, timeout);
        if (winner == responded)
        {
            cts.Cancel(); // tidy up the pending timer
            var score = responded.Result;
            // Draft the review off the score the customer actually gave. context.
            // CurrentUtcDateTime keeps the timestamp deterministic across replays.
            var draftInput = new ReviewDraftInput(
                input.BrandId, input.AppointmentId, score, context.CurrentUtcDateTime);
            var draft = await context.CallActivityAsync<string>(nameof(DraftReview), draftInput);
            log.LogInformation(
                "Appointment {Id} NPS {Score} — review drafted: {Draft}",
                input.AppointmentId, score, draft);
            return "drafted";
        }

        await context.CallActivityAsync(nameof(ExpireNps), input);
        log.LogInformation(
            "Appointment {Id} NPS survey expired (no response within {S}s).",
            input.AppointmentId, input.TimeoutSeconds);
        return "expired";
    }

    // ── Activities (the side-effecting steps; safe to retry) ──────────────────
    [Function(nameof(RequestNps))]
    public static string RequestNps([ActivityTrigger] NpsInput i, FunctionContext fc)
    {
        fc.GetLogger(nameof(RequestNps)).LogInformation(
            "[{Brand}] Post-service NPS survey requested for appointment {Id}.",
            i.BrandId, i.AppointmentId);
        return "requested";
    }

    public record ReviewDraftInput(string BrandId, int AppointmentId, int Score, DateTime At);

    [Function(nameof(DraftReview))]
    public static string DraftReview([ActivityTrigger] ReviewDraftInput i, FunctionContext fc)
    {
        // Review-gen, tiered on the canonical NPS bands. Deterministic templates
        // here keep the demo replay-safe and cost-free; this activity is exactly
        // where an Azure OpenAI / Claude structured-output call would slot in to
        // generate richer copy (the orchestration around it is unchanged).
        var (tier, draft) = i.Score switch
        {
            >= 9 => ("promoter",
                $"⭐ We're thrilled you loved your {i.BrandId} service! " +
                "Mind sharing your experience in a quick public review?"),
            >= 7 => ("passive",
                $"Thanks for choosing {i.BrandId}. We'd love to hear what would " +
                "have made it a 10 — your feedback shapes our next visit."),
            _    => ("detractor",
                $"We're sorry your {i.BrandId} visit fell short. A manager will " +
                "reach out personally to make it right — no public review requested."),
        };
        fc.GetLogger(nameof(DraftReview)).LogInformation(
            "[{Brand}] Review draft ({Tier}, score {Score}) for appointment {Id}.",
            i.BrandId, tier, i.Score, i.AppointmentId);
        return draft;
    }

    [Function(nameof(ExpireNps))]
    public static string ExpireNps([ActivityTrigger] NpsInput i, FunctionContext fc)
    {
        fc.GetLogger(nameof(ExpireNps)).LogInformation(
            "[{Brand}] NPS survey for appointment {Id} expired — no review generated.",
            i.BrandId, i.AppointmentId);
        return "expired";
    }

    // ── HTTP starter: kick off the NPS pipeline for a completed appointment ────
    [Function(nameof(StartNpsWorkflow))]
    public static async Task<HttpResponseData> StartNpsWorkflow(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "nps/{brandId}/{appointmentId:int}/workflow")]
        HttpRequestData req,
        string brandId, int appointmentId,
        [DurableClient] DurableTaskClient client)
    {
        // Short timeout so the demo can show the expiry path without waiting; a real
        // post-service survey would give the customer hours-to-days to respond.
        var timeoutSeconds = int.TryParse(req.Query["timeoutSeconds"], out var s) ? s : 30;
        var instanceId = await client.ScheduleNewOrchestrationInstanceAsync(
            nameof(NpsOrchestrator), new NpsInput(brandId, appointmentId, timeoutSeconds));

        // Built-in helper returns 202 + statusQueryGetUri / raiseEventPostUri etc.
        return await client.CreateCheckStatusResponseAsync(req, instanceId);
    }
}
