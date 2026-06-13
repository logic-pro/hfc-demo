using System.ComponentModel.DataAnnotations;

namespace HfcDemo;

// ── Domain ────────────────────────────────────────────────────────────────
// Two-axis tenancy. FranchiseeId is the ISOLATION key — the boundary a request
// can never cross (a Budget Blinds owner in Irvine must not see Budget Blinds
// Tustin). BrandId is the GROUPING — it bundles franchisees under a brand for
// corporate aggregates, but it is NOT the security boundary. Every tenant-scoped
// entity carries FranchiseeId and is filtered by a global query filter in AppDb;
// the filter keys on the FranchiseeId resolved from the verified token claim.

public class Brand                       // catalog row (not tenant-filtered) — a grouping
{
    public string Id { get; set; } = "";   // slug, e.g. "budget-blinds"
    public string Name { get; set; } = "";
    public string Tagline { get; set; } = "";
}

public class Franchisee                  // the tenancy boundary (catalog/untenanted itself)
{
    public string Id { get; set; } = "";   // slug, e.g. "budget-blinds-irvine"
    public string BrandId { get; set; } = "";   // grouping axis
    public string Name { get; set; } = "";
    public string Region { get; set; } = "";
}

public class Territory                   // tenant-scoped (by FranchiseeId)
{
    public int Id { get; set; }
    public string FranchiseeId { get; set; } = "";   // isolation key
    public string BrandId { get; set; } = "";        // grouping (denormalized)
    public string Name { get; set; } = "";
    public string City { get; set; } = "";
}

public class Slot                        // tenant-scoped, bookable; carries the concurrency token
{
    public int Id { get; set; }
    public string FranchiseeId { get; set; } = "";   // isolation key
    public string BrandId { get; set; } = "";        // grouping
    public int TerritoryId { get; set; }
    public DateTime StartUtc { get; set; }
    public bool IsBooked { get; set; }
    // Optimistic-concurrency token. SQLite has no rowversion, so we use an int
    // marked IsConcurrencyToken and bump it on each update: two writers racing
    // for the same slot — the second one's UPDATE matches 0 rows and EF throws
    // DbUpdateConcurrencyException, which we surface as HTTP 409.
    public int Version { get; set; }
}

public class Appointment                 // tenant-scoped (by FranchiseeId)
{
    public int Id { get; set; }
    public string FranchiseeId { get; set; } = "";   // isolation key
    public string BrandId { get; set; } = "";        // grouping
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

public class NpsSurvey                    // tenant-scoped (by FranchiseeId), like Appointment
{
    public int Id { get; set; }
    public string FranchiseeId { get; set; } = "";   // isolation key — the boundary, copied from the appointment
    public string BrandId { get; set; } = "";        // grouping (denormalized) — corporate roll-ups, not a boundary
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
public record FranchiseeDto(string Id, string BrandId, string BrandName, string Name, string Region);
public record SlotDto(int Id, int TerritoryId, string TerritoryName, DateTime StartUtc, bool IsBooked);
public record BookRequest(int SlotId, string CustomerName, string Service);
public record AppointmentDto(int Id, int TerritoryId, DateTime StartUtc, string CustomerName, string Service, int DepositCents, bool DepositPaid);
public record DepositRequest(int AmountCents);
// Dev-only: exchange a franchisee selection for a signed token (stands in for a
// B2C / Entra login during the demo). Gated to the Development environment.
public record DevTokenRequest(string FranchiseeId);
public record DevTokenResponse(string Token, string FranchiseeId, string BrandId);
// NPS pipeline: post-service survey response and its dashboard-facing read shape.
public record NpsRequest(int Score, string? Comment);
public record NpsSurveyDto(int Id, int AppointmentId, int TerritoryId, int Score, string Comment, DateTime RespondedAt);
