/* ============================================================================
   HFC Corporate Roll-Up Read Model  —  Azure SQL (T-SQL) DDL
   ----------------------------------------------------------------------------
   The read plane behind the franchisor-CEO executive dashboard
   (Portfolio -> Brand -> Region -> Territory).

   Design rules this DDL enforces (see docs/decisions.md ADR-18..21):
     * Pre-aggregated, grain-pure rollup tables. The dashboard reads THESE,
       never the operational tables (Appointment/Slot/Estimate/...).  [ADR-18]
     * Separate `report` schema with NO tenant query filter, written only by
       the nightly aggregation job, read only by the corporate role.   [ADR-19]
     * Two data planes made explicit: every metric carries data_quality_status
       + as_of. Financial (reported) fields are NULLable until they exist;
       deposits/estimates are NEVER stored here as revenue.            [ADR-20]
     * Health = 4 versioned, tenure-curved sub-scores; composite for sort/color
       only; weights live in metric_weight_version, stamped on each row. [ADR-21]

   ID conventions match the operational domain (api/Domain.cs):
     brand_id, franchisee_id  -> NVARCHAR slugs ('budget-blinds', '...-irvine')
     territory_id             -> INT
   Money is stored as DECIMAL here (reporting clarity); the operational app
   stores deposit cents as INT — that stub value is intentionally NOT a source.
   ============================================================================ */

IF SCHEMA_ID(N'report') IS NULL EXEC(N'CREATE SCHEMA report');
GO

/* ---- shared domains ------------------------------------------------------ */
-- data_quality_status, period_type, brand_archetype, risk_band are expressed
-- as CHECK constraints (Azure SQL has no native ENUM). Allowed values:
--   data_quality_status : actual | proxy | partial | estimated | stale | unavailable
--   period_type         : DAY | WTD | MTD | QTD | YTD | TTM | MONTH | QUARTER
--   brand_archetype     : project | recurring | emergency
--   risk_band           : healthy | watch | at_risk | critical


/* ============================================================================
   0. metric_weight_version  —  versioned, Ops-owned health-score weights
   Grain: one row per published weighting. Every score row references the
   version that produced it, so re-weighting never silently rewrites history.
   ============================================================================ */
CREATE TABLE report.metric_weight_version (
    metric_version        NVARCHAR(20)   NOT NULL,   -- e.g. 'v1', 'v2-2026q3'
    description           NVARCHAR(400)  NULL,
    weight_financial      DECIMAL(5,4)   NOT NULL,   -- the four must sum to 1.0000
    weight_customer       DECIMAL(5,4)   NOT NULL,
    weight_growth         DECIMAL(5,4)   NOT NULL,
    weight_compliance     DECIMAL(5,4)   NOT NULL,
    -- tenure ramp: months below which a territory is scored vs. a ramp curve
    -- instead of the brand average (so a new franchisee isn't flagged failing).
    tenure_ramp_months    SMALLINT       NOT NULL CONSTRAINT DF_mwv_ramp DEFAULT (12),
    is_active             BIT            NOT NULL CONSTRAINT DF_mwv_active DEFAULT (0),
    owned_by              NVARCHAR(120)  NOT NULL CONSTRAINT DF_mwv_owner DEFAULT (N'Franchise Ops'),
    published_at          DATETIME2(0)   NOT NULL,
    CONSTRAINT PK_metric_weight_version PRIMARY KEY (metric_version),
    CONSTRAINT CK_mwv_sum CHECK (
        weight_financial + weight_customer + weight_growth + weight_compliance = 1.0)
);
GO
-- exactly one active version at a time
CREATE UNIQUE INDEX UX_mwv_one_active ON report.metric_weight_version(is_active) WHERE is_active = 1;
GO


/* ============================================================================
   1. executive_kpi_snapshot  —  hero-8 KPI row for the CEO landing
   Grain: portfolio + period (one row per period_type per snapshot).
   View 1 hero tiles read exactly one row.
   ============================================================================ */
CREATE TABLE report.executive_kpi_snapshot (
    snapshot_id                BIGINT IDENTITY(1,1) NOT NULL,
    period_type                NVARCHAR(8)   NOT NULL,
    period_start               DATE          NOT NULL,
    period_end                 DATE          NOT NULL,

    -- Tier 1 — reported plane (NULL until invoiceAmount + royalty_rate exist)
    system_wide_gross_sales    DECIMAL(16,2) NULL,
    royalty_revenue            DECIMAL(16,2) NULL,
    same_territory_growth_pct  DECIMAL(9,4)  NULL,   -- franchising's "same-store sales"
    royalty_collection_rate    DECIMAL(9,4)  NULL,

    -- measured / mixed plane
    active_territory_count     INT           NOT NULL,
    active_territory_net_change INT          NOT NULL,
    at_risk_territory_count    INT           NOT NULL,
    network_nps                DECIMAL(6,2)  NULL,
    new_franchise_sales_count  INT           NOT NULL,

    -- YoY deltas + sparkline payload for the tiles (JSON array of trailing points)
    yoy_gross_sales_pct        DECIMAL(9,4)  NULL,
    yoy_royalty_pct            DECIMAL(9,4)  NULL,
    sparkline_json             NVARCHAR(MAX) NULL,

    -- provenance / reproducibility
    source_extracted_at        DATETIME2(0)  NOT NULL,
    calculated_at              DATETIME2(0)  NOT NULL,
    metric_version             NVARCHAR(20)  NOT NULL,
    data_quality_status        NVARCHAR(12)  NOT NULL,
    revenue_gap_note           NVARCHAR(400) NULL,    -- shown in UI when revenue unavailable

    CONSTRAINT PK_executive_kpi_snapshot PRIMARY KEY (snapshot_id),
    CONSTRAINT FK_eks_version FOREIGN KEY (metric_version)
        REFERENCES report.metric_weight_version(metric_version),
    CONSTRAINT CK_eks_period CHECK (period_type IN
        (N'DAY',N'WTD',N'MTD',N'QTD',N'YTD',N'TTM',N'MONTH',N'QUARTER')),
    CONSTRAINT CK_eks_dq CHECK (data_quality_status IN
        (N'actual',N'proxy',N'partial',N'estimated',N'stale',N'unavailable'))
);
GO
-- one current snapshot per period window
CREATE UNIQUE INDEX UX_eks_period ON report.executive_kpi_snapshot(period_type, period_start, period_end);
GO


/* ============================================================================
   2. brand_daily_summary  —  the 8-brand portfolio comparison
   Grain: brand + day.  View 1 brand table; rolls up to the hero snapshot.
   ============================================================================ */
CREATE TABLE report.brand_daily_summary (
    brand_id                   NVARCHAR(64)  NOT NULL,
    summary_date               DATE          NOT NULL,
    brand_name                 NVARCHAR(120) NOT NULL,
    brand_archetype            NVARCHAR(12)  NOT NULL,   -- drives which tiles are meaningful

    -- reported plane (NULLable)
    gross_sales                DECIMAL(16,2) NULL,
    royalty_revenue            DECIMAL(16,2) NULL,
    avg_ticket                 DECIMAL(12,2) NULL,
    same_territory_growth_pct  DECIMAL(9,4)  NULL,

    -- measured plane
    booking_count              INT           NOT NULL CONSTRAINT DF_bds_book DEFAULT (0),
    completed_job_count        INT           NOT NULL CONSTRAINT DF_bds_done DEFAULT (0),
    lead_count                 INT           NOT NULL CONSTRAINT DF_bds_lead DEFAULT (0),
    quote_count                INT           NOT NULL CONSTRAINT DF_bds_quote DEFAULT (0),
    quote_win_rate             DECIMAL(9,4)  NULL,
    completion_rate            DECIMAL(9,4)  NULL,
    cancellation_rate          DECIMAL(9,4)  NULL,
    no_show_rate               DECIMAL(9,4)  NULL,
    nps_score                  DECIMAL(6,2)  NULL,
    review_count               INT           NULL,
    avg_review_rating          DECIMAL(4,2)  NULL,
    referral_count             INT           NOT NULL CONSTRAINT DF_bds_ref DEFAULT (0),
    active_territory_count     INT           NOT NULL CONSTRAINT DF_bds_active DEFAULT (0),
    at_risk_territory_count    INT           NOT NULL CONSTRAINT DF_bds_risk DEFAULT (0),

    calculated_at              DATETIME2(0)  NOT NULL,
    metric_version             NVARCHAR(20)  NOT NULL,
    data_quality_status        NVARCHAR(12)  NOT NULL,

    CONSTRAINT PK_brand_daily_summary PRIMARY KEY (brand_id, summary_date),
    CONSTRAINT CK_bds_archetype CHECK (brand_archetype IN (N'project',N'recurring',N'emergency')),
    CONSTRAINT CK_bds_dq CHECK (data_quality_status IN
        (N'actual',N'proxy',N'partial',N'estimated',N'stale',N'unavailable'))
);
GO
CREATE INDEX IX_bds_date ON report.brand_daily_summary(summary_date) INCLUDE (brand_id, brand_name);
GO


/* ============================================================================
   3. territory_monthly_summary  —  ranking, distribution, same-territory growth
   Grain: territory + month.  View 2 histogram/rankings + View 3 scorecard.
   Carries the four health sub-scores + composite (ADR-21).
   ============================================================================ */
CREATE TABLE report.territory_monthly_summary (
    territory_id               INT           NOT NULL,
    month_start                DATE          NOT NULL,   -- first day of month = grain key
    territory_name             NVARCHAR(160) NOT NULL,
    franchisee_id              NVARCHAR(96)  NOT NULL,
    brand_id                   NVARCHAR(64)  NOT NULL,
    brand_name                 NVARCHAR(120) NOT NULL,
    brand_archetype            NVARCHAR(12)  NOT NULL,
    region                     NVARCHAR(80)  NULL,
    market                     NVARCHAR(80)  NULL,
    state                      NVARCHAR(2)   NULL,
    status                     NVARCHAR(20)  NOT NULL,    -- active | onboarding | closing | closed
    months_in_system           SMALLINT      NULL,        -- tenure (drives ramp curve)

    -- reported plane (NULLable)
    gross_sales                DECIMAL(16,2) NULL,
    royalty_revenue            DECIMAL(16,2) NULL,
    royalty_rate               DECIMAL(5,4)  NULL,
    avg_ticket                 DECIMAL(12,2) NULL,
    yoy_revenue_growth_pct     DECIMAL(9,4)  NULL,
    revenue_index_vs_brand     DECIMAL(9,4)  NULL,        -- territory / brand-avg (1.0 = at average)
    mrr                        DECIMAL(14,2) NULL,        -- recurring archetype only
    active_subscribers         INT           NULL,        -- recurring archetype only

    -- measured plane
    booking_count              INT           NOT NULL CONSTRAINT DF_tms_book DEFAULT (0),
    completed_job_count        INT           NOT NULL CONSTRAINT DF_tms_done DEFAULT (0),
    lead_count                 INT           NOT NULL CONSTRAINT DF_tms_lead DEFAULT (0),
    quote_count                INT           NOT NULL CONSTRAINT DF_tms_quote DEFAULT (0),
    quote_win_rate             DECIMAL(9,4)  NULL,
    completion_rate            DECIMAL(9,4)  NULL,
    cancellation_rate          DECIMAL(9,4)  NULL,
    no_show_rate               DECIMAL(9,4)  NULL,
    slot_utilization_rate      DECIMAL(9,4)  NULL,
    nps_score                  DECIMAL(6,2)  NULL,
    review_count               INT           NULL,
    avg_review_rating          DECIMAL(4,2)  NULL,
    referral_count             INT           NOT NULL CONSTRAINT DF_tms_ref DEFAULT (0),
    repeat_rate                DECIMAL(9,4)  NULL,

    -- health: four sub-scores (NULL if their inputs are unavailable) + composite
    score_financial            SMALLINT      NULL,        -- 0..100; NULL until revenue exists
    score_customer             SMALLINT      NULL,        -- NPS, reviews, repeat
    score_growth               SMALLINT      NULL,        -- YoY, ramp vs. tenure curve
    score_compliance           SMALLINT      NULL,        -- royalty current, brand-standard flags
    score_composite            SMALLINT      NULL,        -- weighted; SORT/COLOR ONLY
    performance_quartile       TINYINT       NULL,        -- 1..4 within brand
    risk_band                  NVARCHAR(10)  NOT NULL CONSTRAINT DF_tms_band DEFAULT (N'healthy'),
    at_risk_reason             NVARCHAR(200) NULL,

    calculated_at              DATETIME2(0)  NOT NULL,
    metric_version             NVARCHAR(20)  NOT NULL,
    data_quality_status        NVARCHAR(12)  NOT NULL,

    CONSTRAINT PK_territory_monthly_summary PRIMARY KEY (territory_id, month_start),
    CONSTRAINT FK_tms_version FOREIGN KEY (metric_version)
        REFERENCES report.metric_weight_version(metric_version),
    CONSTRAINT CK_tms_archetype CHECK (brand_archetype IN (N'project',N'recurring',N'emergency')),
    CONSTRAINT CK_tms_band CHECK (risk_band IN (N'healthy',N'watch',N'at_risk',N'critical')),
    CONSTRAINT CK_tms_quartile CHECK (performance_quartile BETWEEN 1 AND 4),
    CONSTRAINT CK_tms_scores CHECK (
        (score_financial IS NULL OR score_financial BETWEEN 0 AND 100) AND
        (score_customer  IS NULL OR score_customer  BETWEEN 0 AND 100) AND
        (score_growth    IS NULL OR score_growth    BETWEEN 0 AND 100) AND
        (score_compliance IS NULL OR score_compliance BETWEEN 0 AND 100) AND
        (score_composite IS NULL OR score_composite BETWEEN 0 AND 100)),
    CONSTRAINT CK_tms_dq CHECK (data_quality_status IN
        (N'actual',N'proxy',N'partial',N'estimated',N'stale',N'unavailable'))
);
GO
-- brand drill-down + ranking: "this brand's territories this month, ranked"
CREATE INDEX IX_tms_brand_month_score
    ON report.territory_monthly_summary(brand_id, month_start, score_composite DESC)
    INCLUDE (territory_name, region, risk_band, performance_quartile);
-- regional ops lens (RBAC scope = region)
CREATE INDEX IX_tms_region_month
    ON report.territory_monthly_summary(region, month_start) INCLUDE (territory_id, risk_band);
GO


/* ============================================================================
   4. territory_inventory_summary  —  active/sold/available + white-space
   Grain: territory (current state; one row per territory).
   "available" can NOT be inferred from missing activity — needs real inventory.
   ============================================================================ */
CREATE TABLE report.territory_inventory_summary (
    territory_id          INT           NOT NULL,
    territory_name        NVARCHAR(160) NOT NULL,
    brand_id              NVARCHAR(64)  NOT NULL,
    brand_name            NVARCHAR(120) NOT NULL,
    region                NVARCHAR(80)  NULL,
    market                NVARCHAR(80)  NULL,
    state                 NVARCHAR(2)   NULL,
    geo_shape_id          NVARCHAR(80)  NULL,           -- ref to map polygon
    territory_status      NVARCHAR(20)  NOT NULL,       -- available | sold | active | closing | closed
    is_available          BIT           NOT NULL CONSTRAINT DF_tis_avail DEFAULT (0),
    franchisee_id         NVARCHAR(96)  NULL,
    franchisee_name       NVARCHAR(160) NULL,
    sold_date             DATE          NULL,
    open_date             DATE          NULL,
    agreement_start_date  DATE          NULL,
    agreement_end_date    DATE          NULL,           -- renewal-risk source
    renewal_status        NVARCHAR(24)  NULL,           -- current | expiring_90d | expired | not_renewing
    regional_ops_manager  NVARCHAR(120) NULL,
    updated_at            DATETIME2(0)  NOT NULL,
    CONSTRAINT PK_territory_inventory_summary PRIMARY KEY (territory_id)
);
GO
CREATE INDEX IX_tis_brand_status ON report.territory_inventory_summary(brand_id, territory_status);
CREATE INDEX IX_tis_renewal ON report.territory_inventory_summary(agreement_end_date) WHERE renewal_status IS NOT NULL;
GO


/* ============================================================================
   5. royalty_ar_summary  —  royalty billing & collection (reported plane)
   Grain: territory + period.  Requires billing/AR data — until then, unwritten.
   ============================================================================ */
CREATE TABLE report.royalty_ar_summary (
    territory_id          INT           NOT NULL,
    brand_id              NVARCHAR(64)  NOT NULL,
    period_start          DATE          NOT NULL,
    period_end            DATE          NOT NULL,
    gross_sales           DECIMAL(16,2) NULL,
    royalty_rate          DECIMAL(5,4)  NULL,
    royalty_billed        DECIMAL(16,2) NULL,
    royalty_collected     DECIMAL(16,2) NULL,
    royalty_outstanding   DECIMAL(16,2) NULL,
    ar_bucket_0_30        DECIMAL(16,2) NULL,
    ar_bucket_31_60       DECIMAL(16,2) NULL,
    ar_bucket_61_90       DECIMAL(16,2) NULL,
    ar_bucket_90_plus     DECIMAL(16,2) NULL,
    collection_rate       DECIMAL(9,4)  NULL,
    last_payment_date     DATE          NULL,
    calculated_at         DATETIME2(0)  NOT NULL,
    data_quality_status   NVARCHAR(12)  NOT NULL,
    CONSTRAINT PK_royalty_ar_summary PRIMARY KEY (territory_id, period_start, period_end),
    CONSTRAINT CK_ar_dq CHECK (data_quality_status IN
        (N'actual',N'proxy',N'partial',N'estimated',N'stale',N'unavailable'))
);
GO


/* ============================================================================
   6. franchise_pipeline_summary  —  Lead -> Signed funnel (leading indicator)
   Grain: brand/market + period.  Predicts territories opening in 6-9 months.
   ============================================================================ */
CREATE TABLE report.franchise_pipeline_summary (
    brand_id              NVARCHAR(64)  NOT NULL,
    market                NVARCHAR(80)  NOT NULL,
    period_start          DATE          NOT NULL,
    period_end            DATE          NOT NULL,
    lead_count            INT           NOT NULL CONSTRAINT DF_fps_lead DEFAULT (0),
    qualified_count       INT           NOT NULL CONSTRAINT DF_fps_qual DEFAULT (0),
    discovery_count       INT           NOT NULL CONSTRAINT DF_fps_disc DEFAULT (0),
    validation_count      INT           NOT NULL CONSTRAINT DF_fps_val DEFAULT (0),
    agreement_sent_count  INT           NOT NULL CONSTRAINT DF_fps_sent DEFAULT (0),
    signed_count          INT           NOT NULL CONSTRAINT DF_fps_signed DEFAULT (0),
    conversion_rate       DECIMAL(9,4)  NULL,           -- signed / lead
    avg_cycle_days        INT           NULL,
    calculated_at         DATETIME2(0)  NOT NULL,
    CONSTRAINT PK_franchise_pipeline_summary PRIMARY KEY (brand_id, market, period_start, period_end)
);
GO


/* ============================================================================
   7. territory_flag  —  the watchlist, fed by TerritoryFlagged events
   Grain: open flag per (territory, rule). NOT a 2,600-row cron — rows are
   upserted when a territory crosses a threshold and published on the existing
   Service Bus / Durable backbone (ROADMAP §2).
   ============================================================================ */
CREATE TABLE report.territory_flag (
    flag_id               BIGINT IDENTITY(1,1) NOT NULL,
    territory_id          INT           NOT NULL,
    brand_id              NVARCHAR(64)  NOT NULL,
    region                NVARCHAR(80)  NULL,
    rule_key              NVARCHAR(60)  NOT NULL,       -- nps_below_floor | royalty_late | revenue_decline_3q | ...
    severity              NVARCHAR(10)  NOT NULL,       -- watch | at_risk | critical
    detail                NVARCHAR(400) NULL,
    raised_at             DATETIME2(0)  NOT NULL,
    cleared_at            DATETIME2(0)  NULL,           -- NULL = still on the watchlist
    metric_version        NVARCHAR(20)  NOT NULL,
    CONSTRAINT PK_territory_flag PRIMARY KEY (flag_id),
    CONSTRAINT CK_tf_sev CHECK (severity IN (N'watch',N'at_risk',N'critical'))
);
GO
-- one open flag per (territory, rule); resolve before re-raising
CREATE UNIQUE INDEX UX_tf_open ON report.territory_flag(territory_id, rule_key) WHERE cleared_at IS NULL;
CREATE INDEX IX_tf_watchlist ON report.territory_flag(severity, raised_at) WHERE cleared_at IS NULL;
GO


/* ============================================================================
   Seed: the v1 weighting (Franchise-Ops-owned). Tune weights here, bump the
   version, and re-run the rollup — historical rows keep their old version.
   ============================================================================ */
INSERT report.metric_weight_version
    (metric_version, description, weight_financial, weight_customer,
     weight_growth, weight_compliance, tenure_ramp_months, is_active, published_at)
VALUES
    (N'v1', N'Initial rule-based weighting. Financial sub-score inactive until '
          + N'completed_job.invoiceAmount + territory.royalty_rate land.',
     0.35, 0.30, 0.20, 0.15, 12, 1, SYSUTCDATETIME());
GO

/* ----------------------------------------------------------------------------
   THE TWO OPERATIONAL FIELDS THAT UNLOCK TIER 1 (add to the OLTP schema, not
   here). Until these exist, every revenue/royalty field above stays NULL with
   data_quality_status = 'unavailable' — never populated from a deposit or a
   quote (ADR-20):

       ALTER TABLE dbo.Appointment ADD InvoiceAmountCents INT NULL;   -- realized revenue
       ALTER TABLE dbo.Territory   ADD RoyaltyRate DECIMAL(5,4) NULL;  -- 0.0500 = 5%

   ---------------------------------------------------------------------------- */
