using System.ComponentModel.DataAnnotations;

namespace HfcDemo;

// ── Domain ────────────────────────────────────────────────────────────────
// Tenant key throughout is BrandId (a franchise brand). Every tenant-scoped
// entity carries it and is filtered by a global query filter in AppDb, so a
// request for one brand can never read or write another brand's rows — the
// multi-tenant isolation the HFC platform is built on.

public class Brand                       // the tenant + catalog row (not tenant-filtered)
{
    public string Id { get; set; } = "";   // slug, e.g. "budget-blinds"
    public string Name { get; set; } = "";
    public string Tagline { get; set; } = "";
}

public class Territory                   // tenant-scoped
{
    public int Id { get; set; }
    public string BrandId { get; set; } = "";
    public string Name { get; set; } = "";
    public string City { get; set; } = "";
}

public class Slot                        // tenant-scoped, bookable; carries the concurrency token
{
    public int Id { get; set; }
    public string BrandId { get; set; } = "";
    public int TerritoryId { get; set; }
    public DateTime StartUtc { get; set; }
    public bool IsBooked { get; set; }
    // Optimistic-concurrency token. SQLite has no rowversion, so we use an int
    // marked IsConcurrencyToken and bump it on each update: two writers racing
    // for the same slot — the second one's UPDATE matches 0 rows and EF throws
    // DbUpdateConcurrencyException, which we surface as HTTP 409.
    public int Version { get; set; }
}

public class Appointment                 // tenant-scoped
{
    public int Id { get; set; }
    public string BrandId { get; set; } = "";
    public int TerritoryId { get; set; }
    public int SlotId { get; set; }
    public DateTime StartUtc { get; set; }
    [MaxLength(120)] public string CustomerName { get; set; } = "";
    [MaxLength(80)] public string Service { get; set; } = "";
    public int DepositCents { get; set; }
    // Idempotency-Key of the deposit that was applied. A retried POST with the
    // same key returns the existing appointment instead of charging twice.
    public string? DepositKey { get; set; }
}

// ── DTOs (never expose entities directly; keeps the contract stable) ────────
public record BrandDto(string Id, string Name, string Tagline);
public record SlotDto(int Id, int TerritoryId, string TerritoryName, DateTime StartUtc, bool IsBooked);
public record BookRequest(int SlotId, string CustomerName, string Service);
public record AppointmentDto(int Id, int TerritoryId, DateTime StartUtc, string CustomerName, string Service, int DepositCents, bool DepositPaid);
public record DepositRequest(int AmountCents);
