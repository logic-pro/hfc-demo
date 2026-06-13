using System.Net;
using System.Net.Http.Json;
using HfcDemo;
using Xunit;

namespace HfcDemo.Tests;

// Tenant isolation is the MUST guarantee: a request scoped to one franchisee can
// never read or write another franchisee's rows — and the boundary is the
// franchisee, not the brand (two franchisees of the SAME brand are still
// isolated). All access goes through verified token claims; no header trust.
public class TenancyTests
{
    // Seeded franchisees (see Seed.cs). Irvine + Tustin share a brand on purpose.
    private const string BrandBB = "budget-blinds";
    private const string Irvine = "budget-blinds-irvine";
    private const string Tustin = "budget-blinds-tustin";
    private const string BrandAussie = "aussie-pet";
    private const string AussieIrvine = "aussie-pet-irvine";

    [Theory]
    [InlineData("/api/slots")]
    [InlineData("/api/appointments")]
    public async Task TenantEndpoints_WithoutToken_Return401(string path)
    {
        using var factory = new HfcAppFactory();
        var anon = factory.CreateClient();   // no Authorization header

        var resp = await anon.GetAsync(path);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task ValidToken_ForUnknownFranchisee_SeesNoRows()
    {
        // Fail-closed at the query filter: the token is valid and authenticated,
        // but its franchisee claim matches no rows → empty, never everyone's data.
        using var factory = new HfcAppFactory();
        var ghost = factory.ClientFor("ghost-franchisee", "ghost-brand");

        var slots = await ghost.GetFromJsonAsync<List<SlotDto>>("/api/slots");

        Assert.NotNull(slots);
        Assert.Empty(slots);
    }

    [Fact]
    public async Task DifferentBrands_AreIsolated()
    {
        using var factory = new HfcAppFactory();
        var bb = factory.ClientFor(Irvine, BrandBB);
        var aussie = factory.ClientFor(AussieIrvine, BrandAussie);

        var bbSlots = await bb.GetFromJsonAsync<List<SlotDto>>("/api/slots");
        var aussieSlots = await aussie.GetFromJsonAsync<List<SlotDto>>("/api/slots");

        Assert.NotEmpty(bbSlots!);
        Assert.NotEmpty(aussieSlots!);
        // No slot id is visible to both tenants.
        var shared = bbSlots!.Select(s => s.Id).Intersect(aussieSlots!.Select(s => s.Id));
        Assert.Empty(shared);
    }

    [Fact]
    public async Task SameBrand_DifferentFranchisee_IsIsolated()
    {
        // The corrected tenancy model: Budget Blinds Irvine must not see Budget
        // Blinds Tustin, even though they're the same brand.
        using var factory = new HfcAppFactory();
        var irvine = factory.ClientFor(Irvine, BrandBB);
        var tustin = factory.ClientFor(Tustin, BrandBB);

        var irvineSlots = (await irvine.GetFromJsonAsync<List<SlotDto>>("/api/slots"))!;
        var tustinSlots = (await tustin.GetFromJsonAsync<List<SlotDto>>("/api/slots"))!;

        Assert.NotEmpty(irvineSlots);
        Assert.NotEmpty(tustinSlots);
        Assert.Empty(irvineSlots.Select(s => s.Id).Intersect(tustinSlots.Select(s => s.Id)));

        // Irvine books one of its slots; Tustin must not see the appointment.
        var slot = irvineSlots.First(s => !s.IsBooked);
        var book = await irvine.PostAsJsonAsync("/api/appointments",
            new BookRequest(slot.Id, "Irvine Customer", "In-home consult"));
        Assert.Equal(HttpStatusCode.Created, book.StatusCode);

        var irvineAppts = (await irvine.GetFromJsonAsync<List<AppointmentDto>>("/api/appointments"))!;
        var tustinAppts = (await tustin.GetFromJsonAsync<List<AppointmentDto>>("/api/appointments"))!;
        Assert.Contains(irvineAppts, a => a.CustomerName == "Irvine Customer");
        Assert.DoesNotContain(tustinAppts, a => a.CustomerName == "Irvine Customer");
    }

    [Fact]
    public async Task CannotBookAnotherFranchiseesSlot_Returns404()
    {
        // Write isolation: a slot from another franchisee is invisible through the
        // query filter, so a booking attempt resolves to "not found" — never a
        // cross-tenant write.
        using var factory = new HfcAppFactory();
        var irvine = factory.ClientFor(Irvine, BrandBB);
        var tustin = factory.ClientFor(Tustin, BrandBB);

        var tustinSlot = (await tustin.GetFromJsonAsync<List<SlotDto>>("/api/slots"))!.First();

        var resp = await irvine.PostAsJsonAsync("/api/appointments",
            new BookRequest(tustinSlot.Id, "Intruder", "In-home consult"));

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);

        // And Tustin's slot is still open — nothing was written.
        var stillOpen = (await tustin.GetFromJsonAsync<List<SlotDto>>("/api/slots"))!
            .First(s => s.Id == tustinSlot.Id);
        Assert.False(stillOpen.IsBooked);
    }
}
