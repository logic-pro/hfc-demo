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

public class NpsSurvey                    // tenant-scoped; the post-service NPS response
{
    public int Id { get; set; }
    public string BrandId { get; set; } = "";   // tenant key — same isolation as every other entity
    // Denormalized from the appointment so the franchisee dashboards can aggregate
    // NPS *by territory* in one line (a GROUP BY TerritoryId) without joining back
    // to Appointment. This is the "territory-resolvable" guarantee Slice D rides on.
    public int TerritoryId { get; set; }
    public int AppointmentId { get; set; }
    // Clean Net Promoter Score on the canonical 0–10 scale (validated at the edge).
    // Promoter 9–10 / Passive 7–8 / Detractor 0–6 — the dashboard's NPS math is just
    // %promoters − %detractors over this column, so it must never hold anything else.
    public int Score { get; set; }
    [MaxLength(1000)] public string Comment { get; set; } = "";
    public DateTime RespondedAt { get; set; }
}

// ── DTOs (never expose entities directly; keeps the contract stable) ────────
public record BrandDto(string Id, string Name, string Tagline);
public record SlotDto(int Id, int TerritoryId, string TerritoryName, DateTime StartUtc, bool IsBooked);
public record BookRequest(int SlotId, string CustomerName, string Service);
public record AppointmentDto(int Id, int TerritoryId, DateTime StartUtc, string CustomerName, string Service, int DepositCents, bool DepositPaid);
public record DepositRequest(int AmountCents);
public record NpsRequest(int Score, string? Comment);
public record NpsSurveyDto(int Id, int AppointmentId, int TerritoryId, int Score, string Comment, DateTime RespondedAt);
