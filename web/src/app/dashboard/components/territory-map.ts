import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal,
} from '@angular/core';
import { TerritoryListItem } from '../dashboard.models';
import { healthColor, band } from '../ui/health';
import { brandAccent } from '../ui/brand';
import { MAP_H, MAP_W, graticule, project, usOutlinePath } from '../ui/us-geo';

interface MapPoint {
  item: TerritoryListItem;
  x: number; y: number;
  color: string;
  atRisk: boolean;
  active: boolean; // passes the current brand/at-risk filter
}

// D12 — the jaw-drop. Territories plotted on a self-consistent US silhouette,
// shaded by composite health, at-risk dots pulsing. Brand filter + at-risk overlay
// dim the rest; hovering a dot raises a mini-card; clicking drills to the scorecard.
@Component({
  selector: 'ec-territory-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card map-card">
      <header class="map-head">
        <div class="map-title">
          <span class="eyebrow">Territory Health · Continental US</span>
          <h2>Where the network needs attention</h2>
        </div>
        <div class="map-controls">
          <div class="brand-filter" role="group" aria-label="Filter by brand">
            <button class="chip-btn" [class.on]="brandFilter() === null" (click)="setBrand(null)">All brands</button>
            @for (b of brands(); track b.brandId) {
              <button
                class="chip-btn"
                [class.on]="brandFilter() === b.brandId"
                [style.--chip]="b.accent"
                (click)="setBrand(b.brandId)"
              ><span class="chip-swatch"></span>{{ b.brandName }}</button>
            }
          </div>
          <button class="risk-toggle" [class.on]="atRiskOnly()" (click)="toggleRisk()">
            <span class="risk-dot"></span>At-risk only
          </button>
        </div>
      </header>

      <div class="map-stage" [style.aspect-ratio]="W + ' / ' + H">
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="xMidYMid meet" class="map-svg">
          <defs>
            <radialGradient id="mapglow" cx="50%" cy="38%" r="70%">
              <stop offset="0%" stop-color="rgba(95,227,192,.07)" />
              <stop offset="100%" stop-color="rgba(95,227,192,0)" />
            </radialGradient>
            <filter id="dotglow" x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <rect x="0" y="0" [attr.width]="W" [attr.height]="H" fill="url(#mapglow)" />

          <!-- graticule -->
          <g class="grat" stroke="var(--surface-line)" stroke-width="0.5" opacity="0.5">
            @for (gl of grat.lng; track gl.x) { <line [attr.x1]="gl.x" y1="0" [attr.x2]="gl.x" [attr.y2]="H" /> }
            @for (la of grat.lat; track la.y) { <line x1="0" [attr.y1]="la.y" [attr.x2]="W" [attr.y2]="la.y" /> }
          </g>

          <!-- US silhouette -->
          <path [attr.d]="outline" class="us-outline" />

          <!-- territory dots -->
          <g>
            @for (p of points(); track p.item.territoryId) {
              <g
                class="dot-g"
                [class.dim]="!p.active"
                [class.atrisk]="p.atRisk && p.active"
                (mouseenter)="hover(p)"
                (mouseleave)="hover(null)"
                (click)="select.emit(p.item)"
                tabindex="0"
                (focus)="hover(p)"
                (keydown.enter)="select.emit(p.item)"
                role="button"
                [attr.aria-label]="p.item.territoryName + ', composite ' + p.item.compositeScore"
              >
                @if (p.atRisk && p.active) {
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="9" class="pulse-ring" [attr.stroke]="p.color" />
                }
                <circle
                  [attr.cx]="p.x" [attr.cy]="p.y"
                  [attr.r]="hovered()?.item?.territoryId === p.item.territoryId ? 8.5 : 6"
                  [attr.fill]="p.color"
                  class="dot"
                  [attr.filter]="p.active ? 'url(#dotglow)' : null"
                />
              </g>
            }
          </g>
        </svg>

        <!-- hover mini-card -->
        @if (hovered(); as h) {
          <div
            class="mini"
            [style.left.%]="(h.x / W) * 100"
            [style.top.%]="(h.y / H) * 100"
            [class.flip-x]="(h.x / W) > 0.66"
            [class.flip-y]="(h.y / H) > 0.6"
          >
            <div class="mini-row">
              <strong>{{ h.item.territoryName }}</strong>
              <span class="mini-score tnum" [style.color]="h.color">{{ h.item.compositeScore }}</span>
            </div>
            <div class="mini-meta">
              <span class="mini-chip" [style.--chip]="brandAccent(h.item.brandId)">
                <span class="chip-swatch"></span>{{ h.item.brandName }}
              </span>
              <span>{{ h.item.regionName }}</span>
            </div>
            <div class="mini-band" [attr.data-band]="bandOf(h.item.compositeScore)">
              {{ bandLabel(h.item.compositeScore) }} · {{ h.item.tenureBand }}
            </div>
          </div>
        }
      </div>

      <!-- legend -->
      <footer class="map-legend">
        <span class="leg"><span class="leg-dot" style="background:var(--health-strong)"></span>Strong</span>
        <span class="leg"><span class="leg-dot" style="background:var(--health-good)"></span>Good</span>
        <span class="leg"><span class="leg-dot" style="background:var(--health-fair)"></span>Fair</span>
        <span class="leg"><span class="leg-dot" style="background:var(--health-warning)"></span>Warning</span>
        <span class="leg"><span class="leg-dot pulse-leg" style="background:var(--health-critical)"></span>At-risk</span>
        <span class="leg-note">{{ activeCount() }} of {{ points().length }} shown · click a territory to open its scorecard</span>
      </footer>
    </section>
  `,
  styleUrl: './territory-map.css',
})
export class TerritoryMapComponent {
  readonly W = MAP_W;
  readonly H = MAP_H;
  readonly outline = usOutlinePath();
  readonly grat = graticule();

  @Input({ required: true }) set territories(v: TerritoryListItem[]) { this._terr.set(v ?? []); }
  @Output() select = new EventEmitter<TerritoryListItem>();

  private readonly _terr = signal<TerritoryListItem[]>([]);
  readonly brandFilter = signal<number | null>(null);
  readonly atRiskOnly = signal(false);
  readonly hovered = signal<MapPoint | null>(null);

  readonly brands = computed(() => {
    const seen = new Map<number, { brandId: number; brandName: string; accent: string }>();
    for (const t of this._terr()) {
      if (!seen.has(t.brandId)) seen.set(t.brandId, { brandId: t.brandId, brandName: t.brandName, accent: this.brandAccent(t.brandId) });
    }
    return [...seen.values()];
  });

  readonly points = computed<MapPoint[]>(() => {
    const bf = this.brandFilter();
    const risk = this.atRiskOnly();
    return this._terr().map((item) => {
      const { x, y } = project(item.lat, item.lng);
      const atRisk = item.compositeScore < 50;
      const passBrand = bf === null || item.brandId === bf;
      const passRisk = !risk || atRisk;
      return { item, x, y, color: healthColor(item.compositeScore), atRisk, active: passBrand && passRisk };
    });
  });

  readonly activeCount = computed(() => this.points().filter((p) => p.active).length);

  brandAccent(id: number): string { return brandAccent(id); }
  bandOf(score: number): string { return band(score); }
  bandLabel(score: number): string {
    const b = band(score);
    return b.charAt(0).toUpperCase() + b.slice(1);
  }

  setBrand(id: number | null): void { this.brandFilter.set(id); }
  toggleRisk(): void { this.atRiskOnly.update((v) => !v); }
  hover(p: MapPoint | null): void { if (!p || p.active) this.hovered.set(p); }
}
