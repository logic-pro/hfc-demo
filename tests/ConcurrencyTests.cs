using System.Net;
using System.Net.Http.Json;
using HfcDemo;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace HfcDemo.Tests;

// Double-booking prevention via optimistic concurrency on Slot.Version: two
// writers racing for the same slot — exactly one wins (201), the rest get 409.
public class ConcurrencyTests : IDisposable
{
    private const string BrandBB = "budget-blinds";
    private const string Irvine = "budget-blinds-irvine";

    // File-backed SQLite so concurrent requests use independent connections and
    // genuinely race (a shared single in-memory connection would serialize them).
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"hfc-conc-{Guid.NewGuid():N}.db");

    [Fact]
    public async Task ConcurrentBookings_SameSlot_ExactlyOneSucceeds_RestGet409()
    {
        using var factory = new HfcAppFactory($"Data Source={_dbPath}");
        var client = factory.ClientFor(Irvine, BrandBB);

        var slot = (await client.GetFromJsonAsync<List<SlotDto>>("/api/slots"))!
            .First(s => !s.IsBooked);

        // Fire several bookings for the same slot at once.
        const int racers = 6;
        var tasks = Enumerable.Range(0, racers).Select(i =>
            client.PostAsJsonAsync("/api/appointments",
                new BookRequest(slot.Id, $"Racer {i}", "In-home consult")));
        var responses = await Task.WhenAll(tasks);

        var created = responses.Count(r => r.StatusCode == HttpStatusCode.Created);
        var conflicts = responses.Count(r => r.StatusCode == HttpStatusCode.Conflict);

        Assert.Equal(1, created);                 // exactly one winner
        Assert.Equal(racers - 1, conflicts);      // everyone else gets 409 — no 500s, no double-book

        // And the slot is booked exactly once.
        var booked = (await client.GetFromJsonAsync<List<SlotDto>>("/api/slots"))!
            .Single(s => s.Id == slot.Id);
        Assert.True(booked.IsBooked);
    }

    [Fact]
    public async Task OptimisticConcurrencyToken_SecondWriterThrows()
    {
        // Deterministic, white-box proof of the token itself: two contexts load
        // the same slot (both see Version=0), the first commits, the second's
        // UPDATE … WHERE Version=0 matches no rows → DbUpdateConcurrencyException.
        using var factory = new HfcAppFactory($"Data Source={_dbPath}");
        using var scope1 = factory.Services.CreateScope();
        using var scope2 = factory.Services.CreateScope();

        var tenant1 = scope1.ServiceProvider.GetRequiredService<TenantContext>();
        tenant1.FranchiseeId = Irvine;
        var db1 = scope1.ServiceProvider.GetRequiredService<AppDb>();

        var tenant2 = scope2.ServiceProvider.GetRequiredService<TenantContext>();
        tenant2.FranchiseeId = Irvine;
        var db2 = scope2.ServiceProvider.GetRequiredService<AppDb>();

        var slot1 = await db1.Slots.FirstAsync(s => !s.IsBooked);
        var slot2 = await db2.Slots.FirstAsync(s => s.Id == slot1.Id);

        slot1.IsBooked = true; slot1.Version++;
        await db1.SaveChangesAsync();             // first writer wins

        slot2.IsBooked = true; slot2.Version++;
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => db2.SaveChangesAsync());
    }

    public void Dispose()
    {
        foreach (var f in new[] { _dbPath, _dbPath + "-wal", _dbPath + "-shm" })
            if (File.Exists(f)) File.Delete(f);
    }
}
