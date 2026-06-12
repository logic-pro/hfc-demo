using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging;
using System.Net;

namespace HfcDemo.Functions;

// Post-booking lifecycle as a Durable Functions orchestration.
//
// Why Durable Functions and not a background thread in the API: this workflow
// spans minutes-to-days (wait for a deposit, send a reminder, expire if unpaid)
// and must survive process restarts, deploys, and scale-to-zero. The orchestrator
// is replayed from its event history, so its state is durable without us managing
// any of it — the textbook stateful-orchestration / human-interaction pattern.
//
// Flow: confirm -> reminder -> await "DepositPaid" event OR timeout -> finalize/expire.

public record BookingInput(string BrandId, int AppointmentId, int TimeoutSeconds);

public static class BookingWorkflow
{
    // ── Orchestrator ─────────────────────────────────────────────────────────
    [Function(nameof(BookingOrchestrator))]
    public static async Task<string> BookingOrchestrator(
        [OrchestrationTrigger] TaskOrchestrationContext context)
    {
        var input = context.GetInput<BookingInput>()!;
        var log = context.CreateReplaySafeLogger(nameof(BookingOrchestrator));

        await context.CallActivityAsync(nameof(ConfirmBooking), input);

        // Durable timer: a reminder a bit after confirmation. context.CurrentUtcDateTime
        // (not DateTime.UtcNow) keeps replay deterministic.
        await context.CreateTimer(context.CurrentUtcDateTime.AddSeconds(2), CancellationToken.None);
        await context.CallActivityAsync(nameof(SendReminder), input);

        // Human-interaction pattern: wait for an external "DepositPaid" event, but
        // bound it with a durable timer so an abandoned booking expires and releases
        // the slot instead of waiting forever. This timeout is the part people miss.
        using var cts = new CancellationTokenSource();
        var deadline = context.CurrentUtcDateTime.AddSeconds(input.TimeoutSeconds);
        Task timeout = context.CreateTimer(deadline, cts.Token);
        Task<double> paid = context.WaitForExternalEvent<double>("DepositPaid");

        var winner = await Task.WhenAny(paid, timeout);
        if (winner == paid)
        {
            cts.Cancel(); // tidy up the pending timer
            await context.CallActivityAsync(nameof(FinalizeBooking), input);
            log.LogInformation("Appointment {Id} finalized (deposit ${Amt}).", input.AppointmentId, paid.Result);
            return "finalized";
        }

        await context.CallActivityAsync(nameof(ExpireBooking), input);
        log.LogInformation("Appointment {Id} expired (no deposit within {S}s).", input.AppointmentId, input.TimeoutSeconds);
        return "expired";
    }

    // ── Activities (the side-effecting steps; safe to retry) ──────────────────
    [Function(nameof(ConfirmBooking))]
    public static string ConfirmBooking([ActivityTrigger] BookingInput i, FunctionContext fc)
    {
        fc.GetLogger(nameof(ConfirmBooking)).LogInformation(
            "[{Brand}] Confirmation sent for appointment {Id}.", i.BrandId, i.AppointmentId);
        return "confirmed";
    }

    [Function(nameof(SendReminder))]
    public static string SendReminder([ActivityTrigger] BookingInput i, FunctionContext fc)
    {
        fc.GetLogger(nameof(SendReminder)).LogInformation(
            "[{Brand}] Reminder: deposit due for appointment {Id}.", i.BrandId, i.AppointmentId);
        return "reminded";
    }

    [Function(nameof(FinalizeBooking))]
    public static string FinalizeBooking([ActivityTrigger] BookingInput i, FunctionContext fc)
    {
        fc.GetLogger(nameof(FinalizeBooking)).LogInformation(
            "[{Brand}] Appointment {Id} confirmed & paid — crew scheduled.", i.BrandId, i.AppointmentId);
        return "finalized";
    }

    [Function(nameof(ExpireBooking))]
    public static string ExpireBooking([ActivityTrigger] BookingInput i, FunctionContext fc)
    {
        fc.GetLogger(nameof(ExpireBooking)).LogInformation(
            "[{Brand}] Appointment {Id} expired — slot released.", i.BrandId, i.AppointmentId);
        return "expired";
    }

    // ── HTTP starter: kick off an orchestration for an appointment ────────────
    [Function(nameof(StartBookingWorkflow))]
    public static async Task<HttpResponseData> StartBookingWorkflow(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "bookings/{brandId}/{appointmentId:int}/workflow")]
        HttpRequestData req,
        string brandId, int appointmentId,
        [DurableClient] DurableTaskClient client)
    {
        // Short timeout so the demo can show expiry without waiting; real default would be hours.
        var timeoutSeconds = int.TryParse(req.Query["timeoutSeconds"], out var s) ? s : 30;
        var instanceId = await client.ScheduleNewOrchestrationInstanceAsync(
            nameof(BookingOrchestrator), new BookingInput(brandId, appointmentId, timeoutSeconds));

        // Built-in helper returns 202 + statusQueryGetUri / raiseEventPostUri etc.
        return await client.CreateCheckStatusResponseAsync(req, instanceId);
    }
}
