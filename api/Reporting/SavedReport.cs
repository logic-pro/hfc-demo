using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HfcDemo.Reporting;

// ── saved_report — additive corporate-plane table (§C2) ──────────────────────
// A persisted report DEFINITION (the query the user built). Lives in the same
// store as the read model and, like the other corporate read-model tables
// (territory_period_summary / watchlist_flag), carries NO tenant query filter —
// the corporate/read-down lens is a scope filter applied at request time, not
// row-level tenancy. The definition is stored as JSON so the wire shape can
// evolve additively without a schema change.
public class SavedReport
{
    public string Id { get; set; } = "";              // "rep_<guid>"
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";

    // The scope that created the report — drives the read-down library RBAC.
    public string OwnerScopeLevel { get; set; } = ""; // network | brand | region
    public int? OwnerScopeId { get; set; }            // brand/region numeric id; null for network

    public string DefinitionJson { get; set; } = "";  // serialized ReportQueryRequest
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class SavedReportConfig : IEntityTypeConfiguration<SavedReport>
{
    public void Configure(EntityTypeBuilder<SavedReport> b)
    {
        b.ToTable("saved_report");
        b.HasKey(x => x.Id);
        b.HasIndex(x => new { x.OwnerScopeLevel, x.OwnerScopeId });
    }
}

// The project bootstraps schema with EnsureCreated() (no migrations). EnsureCreated
// is a no-op on an ALREADY-created database, so a pre-existing hfc-demo.db would
// never gain this new table. This idempotent guard closes that gap additively:
// fresh DBs get the table from EnsureCreated; stale DBs get it here. Columns match
// the entity by name so EF reads/writes them regardless of which path created the
// table (SQLite is dynamically typed). Pure DDL IF NOT EXISTS — never drops/alters.
public static class ReportingStore
{
    public static void EnsureCreated(AppDb db)
    {
        db.Database.ExecuteSqlRaw(
            """
            CREATE TABLE IF NOT EXISTS saved_report (
                Id              TEXT    NOT NULL CONSTRAINT PK_saved_report PRIMARY KEY,
                Name            TEXT    NOT NULL,
                Description     TEXT    NOT NULL,
                OwnerScopeLevel TEXT    NOT NULL,
                OwnerScopeId    INTEGER NULL,
                DefinitionJson  TEXT    NOT NULL,
                CreatedAt       TEXT    NOT NULL,
                UpdatedAt       TEXT    NOT NULL
            );
            """);
    }
}
