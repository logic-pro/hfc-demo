import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DashboardDataService } from './dashboard-data.service';
import { CorporateDashboard, TerritoryListItem } from './dashboard.models';
import { KpiTileComponent } from './components/kpi-tile';
import { TerritoryMapComponent } from './components/territory-map';

// The executive landing surface. v1 wires the hero-8 (D11); the map, distribution,
// provenance, scorecard and watchlist sections land in subsequent slices. Loads
// the corporate roll-up (NOT raw operational tables — CONTRACT boundary rule).
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KpiTileComponent, TerritoryMapComponent],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardComponent {
  private data = inject(DashboardDataService);

  readonly corporate = signal<CorporateDashboard | null>(null);
  readonly territories = signal<TerritoryListItem[]>([]);
  readonly loading = signal(true);
  readonly mapLoading = signal(true);
  readonly error = signal<string | null>(null);

  // Drill target — set by clicking a map dot / table row; opens the scorecard (D14).
  readonly selectedTerritoryId = signal<number | null>(null);

  readonly vitalSigns = computed(() => this.corporate()?.vitalSigns ?? []);
  readonly dataNotes = computed(() => this.corporate()?.dataNotes ?? []);
  readonly period = computed(() => this.corporate()?.period ?? null);
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
  }

  selectTerritory(t: TerritoryListItem): void {
    this.selectedTerritoryId.set(t.territoryId);
  }
}
