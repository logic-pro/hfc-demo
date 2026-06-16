using System.ComponentModel.DataAnnotations;

namespace HfcDemo;

// ── Domain ────────────────────────────────────────────────────────────────
// Two-axis tenancy. FranchiseeId is the ISOLATION key — the boundary a request
// can never cross (a Budget Blinds owner in Irvine must not see Budget Blinds
// Tustin). BrandId is the GROUPING — it bundles franchisees under a brand for
// corporate aggregates, but it is NOT the security boundary. Every tenant-scoped
// entity carries FranchiseeId and is filtered by a global query filter in AppDb;
// the filter keys on the FranchiseeId resolved from the verified token claim.
//
// The corporate read model (ReadModel.cs) is a SEPARATE plane keyed by numeric
// ids (CONTRACT §1). The Brand.Num / Franchisee.Num bridges map the operational
// string slugs onto those numeric dashboard ids — assigned in seed, stable.

public class Brand                       // catalog row (not tenant-filtered) — a grouping
{
    public string Id { get; set; } = "";   // slug, e.g. "budget-blinds" — PK
    public string Name { get; set; } = "";
    public string Tagline { get; set; } = "";

    // ── Dashboard additions (D0) ─────────────────────────────────────────────
    // Numeric dashboard id. The CONTRACT read model + DTOs key brands by INTEGER
    // (brand_id); the operational tenant key stays the slug. `Num` is the stable
    // bridge between the two — assigned in seed, unique, never reused.
    public int Num { get; set; }
    // One of the three service archetypes the dashboard groups by:
    // project_installation | recurring_service | emergency_response.
    // Empty for catalog brands not in the dashboard demo set.
    public string Archetype { get; set; } = "";
    // Franchise royalty rate (0..1) applied to gross sales. Per-brand for the
    // demo; real agreements vary by territory/contract (Track 2).
    public double RoyaltyRate { get; set; }
}

// The tenancy boundary (catalog/untenanted itself). A franchisee is the data
// CONTROLLER: it owns the operational rows; corporate reads only the rolled-up
// read model, never the franchisee's raw rows directly (see RecomputeRollup).
public class Franchisee
{
    public string Id { get; set; } = "";   // slug, e.g. "budget-blinds-irvine" — isolation key
    public string BrandId { get; set; } = "";   // grouping axis
    public string Name { get; set; } = "";
    public string Region { get; set; } = "";

    // ── Dashboard bridge (D0) ────────────────────────────────────────────────
    // Numeric dashboard id (the read model's franchisee_id, CONTRACT §1). >0 for
    // the dashboard demo operators; 0 for booking-only franchisees not in the
    // dashboard set. Parallels Brand.Num — the slug stays the operational key.
    public int Num { get; set; }
}

public class Territory                   // tenant-scoped (by FranchiseeId)
{
    public int Id { get; set; }
    public string FranchiseeId { get; set; } = "";   // isolation key
    public string BrandId { get; set; } = "";        // grouping (denormalized)
    public string Name { get; set; } = "";
    public string City { get; set; } = "";

    // ── Dashboard additions (D0) ─────────────────────────────────────────────
    public int? RegionId { get; set; }           // null = not in dashboard demo set
    public double? Lat { get; set; }             // map coords, clustered by region
    public double? Lng { get; set; }
    public DateTime? OpenDate { get; set; }      // drives tenure_band
    public string Status { get; set; } = "open"; // open | closed
}

// ── Region (D0) — a geographic grouping of territories ──────────────────────
public class Region
{
    public int Id { get; set; }
    public string Name { get; set; } = "";        // e.g. "West", "East"
}

// ── MonthlyReport (D0) — the franchisee-reported (seeded) plane ─────────────
// One row per (territory, period). This is the single source of the *reported*
// metrics (financials + NPS + ratings) that, in reality, arrive via royalty
// reports and lag the measured operational plane. For the demo they are seeded
// and labeled Illustrative. `Reported=false` for the current cycle is how a
// territory legitimately lands on pending_financial_reporting (financial_score
// = null) — corporate never fabricates a financial score from a missing report.
//
// It is franchisee-owned operational data, so it carries FranchiseeId and is
// tenant-filtered like the other operational tables; only RecomputeRollup reads
// it cross-tenant (IgnoreQueryFilters).
//
// NPS lives ONLY here, so flipping its provenance seeded→measured when the NPS
// pipeline (Slice C) lands is the one-line change D-NPS-SWAP.
public class MonthlyReport
{
    public int Id { get; set; }
    public string FranchiseeId { get; set; } = "";   // isolation key
    public int TerritoryId { get; set; }
    public string BrandId { get; set; } = "";        // grouping
    public int PeriodId { get; set; }             // YYYYMM
    public DateTime PeriodStart { get; set; }
    public DateTime PeriodEnd { get; set; }

    public bool Reported { get; set; }            // false => pending this cycle
    public DateTime? ReportedAt { get; set; }     // as-of for the reported plane

    // Seeded financial plane (Illustrative)
    public double GrossRevenue { get; set; }
    public double RoyaltyCollected { get; set; }  // amount actually remitted
    public double SameTerritoryGrowth { get; set; } // YoY, seeded (needs history)
    public double Mrr { get; set; }               // recurring-service archetype only

    // Seeded customer plane (Illustrative). NPS_SWAP: single source point.
    public int NpsScore { get; set; }             // 0..100 NPS scale
    public double GoogleRating { get; set; }      // 1..5
    public double QuoteToClose { get; set; }      // 0..1
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

    // ── Dashboard additions (D0) ─────────────────────────────────────────────
    // Lifecycle status, the measured-plane source for completion/no-show rates:
    // scheduled | completed | cancelled | no_show.
    public string Status { get; set; } = "scheduled";
    // Realized invoice (cents) on a completed job — the only honest input to
    // gross sales. Deposits/estimates are NOT revenue (franchise-kpi-metric-guard).
    // For the demo the reported plane is seeded at MonthlyReport grain; this field
    // exists so the measured→reported swap is a data-source change, not a reshape.
    public int InvoiceCents { get; set; }
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
// Num: the numeric dashboard brand id (Brand.Num). Additive — the login picker
// mints a brand-scope token from it; existing callers ignore the extra field.
public record BrandDto(string Id, string Name, string Tagline, int Num);
public record FranchiseeDto(string Id, string BrandId, string BrandName, string Name, string Region);
// Region reference for the region-manager login persona: the numeric region id the
// token mint takes, plus a display name. Mirrors the web RegionRef { id, name }.
public record RegionDto(int Id, string Name);
public record SlotDto(int Id, int TerritoryId, string TerritoryName, DateTime StartUtc, bool IsBooked);
public record BookRequest(int SlotId, string CustomerName, string Service);
public record AppointmentDto(int Id, int TerritoryId, DateTime StartUtc, string CustomerName, string Service, int DepositCents, bool DepositPaid);
public record DepositRequest(int AmountCents);
// Dev-only: exchange a login selection for a signed token (stands in for a B2C /
// Entra login during the demo). Gated to the Development environment. Covers the
// whole 4-tier hierarchy, backward compatible (every field optional):
//   {"franchiseeId":"…"}                 → operator (tenant-scoped)
//   {"role":"corporate"} | {"scope":"network"} → network read-down (all)
//   {"scope":"brand","brandId":N}        → brand read-down
//   {"scope":"region","regionId":N}      → region read-down
// `Scope` is what the web login picker sends for brand/region; `Role` is the
// network alias. Both accepted so the API tolerates either wording.
public record DevTokenRequest(
    string? FranchiseeId = null, string? Role = null, string? Scope = null,
    int? BrandId = null, int? RegionId = null);
// Scope echoes the tier the token carries (network|brand|region|franchisee) so the
// web can label the session; the corporate tiers omit the operator tenant ids.
public record DevTokenResponse(string Token, string? FranchiseeId, string? BrandId, string? Scope = null);
// NPS pipeline: post-service survey response and its dashboard-facing read shape.
// Score is nullable so an OMITTED score is detectable (and rejected) rather than
// silently binding to 0 — a missing required field, not a real "0/10" rating.
public record NpsRequest(int? Score, string? Comment);
public record NpsSurveyDto(int Id, int AppointmentId, int TerritoryId, int Score, string Comment, DateTime RespondedAt);
