import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DashboardDataService } from './dashboard-data.service';
import {
  CorporateDashboard, ProvenanceType, TerritoryHealthScore, TerritoryListItem, WatchlistFlag,
} from './dashboard.models';
import { KpiTileComponent } from './components/kpi-tile';
import { TerritoryMapComponent } from './components/territory-map';
import { ScorecardComponent } from './components/scorecard';
import { DistributionComponent } from './components/distribution';
import { BrandTableComponent } from './components/brand-table';
import { ProvenanceComponent } from './components/provenance';
import { WatchlistComponent } from './components/watchlist';
import { brandAccent } from './ui/brand';

// The executive landing surface. v1 wires the hero-8 (D11); the map, distribution,
// provenance, scorecard and watchlist sections land in subsequent slices. Loads
// the corporate roll-up (NOT raw operational tables — CONTRACT boundary rule).
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    KpiTileComponent, TerritoryMapComponent, ScorecardComponent,
    DistributionComponent, BrandTableComponent, ProvenanceComponent, WatchlistComponent,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardComponent {
  private data = inject(DashboardDataService);

  readonly corporate = signal<CorporateDashboard | null>(null);
  readonly territories = signal<TerritoryListItem[]>([]);
  readonly watchlist = signal<WatchlistFlag[]>([]);
  readonly loading = signal(true);
  readonly mapLoading = signal(true);
  readonly watchlistLoading = signal(true);
  readonly error = signal<string | null>(null);

  // Drill target — set by clicking a map dot / table row; opens the scorecard (D14).
  readonly selectedTerritoryId = signal<number | null>(null);
  readonly scoreData = signal<TerritoryHealthScore | null>(null);
  readonly scoreLoading = signal(false);
  readonly scorecardOpen = computed(() => this.selectedTerritoryId() !== null);

  readonly vitalSigns = computed(() => this.corporate()?.vitalSigns ?? []);
  readonly brandComparison = computed(() => this.corporate()?.brandComparison ?? []);
  readonly dataNotes = computed(() => this.corporate()?.dataNotes ?? []);
  readonly period = computed(() => this.corporate()?.period ?? null);

  // Brand scope — the portfolio→brand drill level. ONE signal drives the map, the
  // distribution and the brand table (D17): pick a brand in any of them and all
  // three re-scope together. null = whole portfolio.
  readonly selectedBrandId = signal<number | null>(null);
  readonly selectedBrand = computed(
    () => this.brandComparison().find((b) => b.brandId === this.selectedBrandId()) ?? null,
  );

  // D17: which data source is live. Display-only — the actual swap lives in the
  // data service behind the same flag (window.__DASHBOARD_LIVE__).
  readonly liveMode = (window as any).__DASHBOARD_LIVE__ === true;

  // D16: the provenance plane the user is highlighting. Drives the hero re-skin —
  // the provenance panel and every kpi-tile read this one signal. null = show all.
  readonly provenanceFilter = signal<ProvenanceType | null>(null);
  // Hero skeletons: render 8 placeholders so layout doesn't reflow on load.
  readonly skeletons = Array.from({ length: 8 });

  constructor() {
    // Independent panels load in parallel — neither blocks the other (no whole-page gate).
    this.data.corporate().subscribe({
      next: (c) => { this.corporate.set(c); this.loading.set(false); },
      error: () => { this.error.set('Could not load the corporate roll-up.'); this.loading.set(false); },
    });
    this.data.territories().subscribe({
      next: (r) => { this.territories.set(r.items); this.mapLoading.set(false); },
      error: () => { this.mapLoading.set(false); },
    });
    this.data.watchlist().subscribe({
      next: (w) => { this.watchlist.set(w.items); this.watchlistLoading.set(false); },
      error: () => { this.watchlistLoading.set(false); },
    });
  }

  // Map + distribution emit a full territory; the watchlist emits just an id —
  // both converge on one drill so the scorecard is the single explainable surface.
  selectTerritory(t: TerritoryListItem): void { this.openTerritory(t.territoryId); }
  selectTerritoryId(territoryId: number): void { this.openTerritory(territoryId); }

  private openTerritory(territoryId: number): void {
    this.selectedTerritoryId.set(territoryId);
    this.scoreData.set(null);
    this.scoreLoading.set(true);
    this.data.healthScore(territoryId).subscribe({
      next: (s) => { this.scoreData.set(s); this.scoreLoading.set(false); },
      error: () => { this.scoreLoading.set(false); },
    });
  }

  closeScorecard(): void {
    this.selectedTerritoryId.set(null);
  }

  // Components resolve their own toggle and emit the next scope (null clears); the
  // dashboard just records it. Both the map's chips and the table's rows land here.
  selectBrand(brandId: number | null): void {
    this.selectedBrandId.set(brandId);
  }

  brandAccent(id: number): string { return brandAccent(id); }

  setProvenancePlane(plane: ProvenanceType | null): void {
    this.provenanceFilter.set(plane);
  }
}
