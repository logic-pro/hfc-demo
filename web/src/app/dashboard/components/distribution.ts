import {
  AfterViewInit, ChangeDetectionStrategy, Component, EventEmitter, Input, Output,
  computed, signal,
} from '@angular/core';
import { TerritoryListItem } from '../dashboard.models';
import {
  BANDS, BAND_LABEL, BAND_RANGE, HealthBand, band, bandHex, healthColor,
} from '../ui/health';
import { brandAccent } from '../ui/brand';

interface Bar {
  i: number;
  band: HealthBand;
  label: string;
  range: string;
  count: number;
  barX: number; barW: number; cx: number;
  y: number; h: number; labelY: number;
  color: string;
}

interface GridTick { value: number; y: number; }

// D13 (left) — performance distribution. The CEO question this answers is the one
// an average hides: "is the network healthy, or is a strong mean masking an at-risk
// tail?" 24 territories bucketed into the shared health bands (worst on the left so
// the intervention tail reads first), hand-rolled SVG, bars grow in. Clicking a bar
// lists its territories ranked; clicking a territory drills to its scorecard. The
// brand filter (set by the comparison table) re-buckets to one brand.
@Component({
  selector: 'ec-distribution',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card dist-card">
      <header class="dist-head">
        <div class="dist-title">
          <span class="eyebrow">Performance Distribution · Composite Health</span>
          <h2>Is the average hiding an at-risk tail?</h2>
        </div>
        <div class="dist-scope">
          <span class="pill">{{ scopeLabel() }}</span>
        </div>
      </header>

      <!-- Stat strip — the median/mean/floor answer in three numbers. -->
      <div class="dist-stats">
        <div class="stat">
          <span class="stat-num tnum" [style.color]="medianColor()">{{ stats().median }}</span>
          <span class="stat-cap">Median</span>
        </div>
        <div class="stat">
          <span class="stat-num tnum" [style.color]="meanColor()">{{ stats().mean }}</span>
          <span class="stat-cap">Mean</span>
        </div>
        <div class="stat">
          <span class="stat-num tnum" [class.alarm]="stats().belowFloor > 0">{{ stats().belowFloor }}</span>
          <span class="stat-cap">Below floor</span>
        </div>
        <div class="stat">
          <span class="stat-num tnum">{{ stats().total }}</span>
          <span class="stat-cap">Territories</span>
        </div>
      </div>

      <div class="dist-stage">
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="xMidYMid meet" class="dist-svg" role="img"
          [attr.aria-label]="'Distribution of ' + stats().total + ' territories across five health bands'">
          <!-- y gridlines + count ticks -->
          <g class="grid">
            @for (t of ticks(); track t.value) {
              <line [attr.x1]="AX" [attr.x2]="W - PADR" [attr.y1]="t.y" [attr.y2]="t.y" />
              <text [attr.x]="AX - 8" [attr.y]="t.y + 3" class="tick tnum">{{ t.value }}</text>
            }
          </g>
          <!-- baseline -->
          <line [attr.x1]="AX" [attr.x2]="W - PADR" [attr.y1]="baseY" [attr.y2]="baseY" class="axis" />

          <!-- bars -->
          @for (b of bars(); track b.band) {
            <g
              class="bar-g"
              [class.active]="b.band === activeBand()"
              [class.muted]="b.band !== activeBand()"
              (click)="pick(b.band)"
              (keydown.enter)="pick(b.band)"
              tabindex="0"
              role="button"
              [attr.aria-label]="b.count + ' ' + b.label + ' territories (' + b.range + ')'"
            >
              <!-- full-height hit/hover zone -->
              <rect [attr.x]="b.cx - colW / 2" [attr.y]="PADT" [attr.width]="colW" [attr.height]="baseY - PADT" class="bar-hit" />
              <rect
                class="bar-rect"
                [attr.x]="b.barX" [attr.width]="b.barW" [attr.rx]="3"
                [attr.y]="mounted() ? b.y : baseY"
                [attr.height]="mounted() ? b.h : 0"
                [attr.fill]="b.color"
                [style.transition-delay.ms]="b.i * 70"
              />
              <text
                class="bar-count tnum"
                [class.shown]="mounted()"
                [attr.x]="b.cx" [attr.y]="b.labelY"
                [style.transition-delay.ms]="b.i * 70 + 280"
              >{{ b.count }}</text>
              <text class="bar-label" [attr.x]="b.cx" [attr.y]="baseY + 22">{{ b.label }}</text>
              <text class="bar-range tnum" [attr.x]="b.cx" [attr.y]="baseY + 38">{{ b.range }}</text>
            </g>
          }
        </svg>
      </div>

      <!-- Click-to-drill: the selected band's territories, ranked, → scorecard. -->
      <div class="dist-drill">
        <div class="drill-head">
          <span class="drill-band" [style.color]="bandHex(activeBand())">
            <span class="drill-swatch" [style.background]="bandHex(activeBand())"></span>
            {{ bandLabel(activeBand()) }}
          </span>
          <span class="drill-hint">{{ drillItems().length }} territories · click to open scorecard</span>
        </div>
        @if (drillItems().length) {
          <ul class="drill-list">
            @for (t of drillItems(); track t.territoryId) {
              <li
                class="drill-row"
                (click)="select.emit(t)"
                (keydown.enter)="select.emit(t)"
                tabindex="0"
                role="button"
                [attr.aria-label]="'Open scorecard for ' + t.territoryName"
              >
                <span class="dr-score tnum" [style.color]="healthColor(t.compositeScore)">{{ t.compositeScore }}</span>
                <span class="dr-name">{{ t.territoryName }}</span>
                <span class="dr-chip" [style.--chip]="accent(t.brandId)">
                  <span class="dr-swatch"></span>{{ t.brandName }}
                </span>
                <span class="dr-go" aria-hidden="true">→</span>
              </li>
            }
          </ul>
        } @else {
          <p class="drill-empty">No territories in this band for the current selection.</p>
        }
      </div>
    </section>
  `,
  styleUrl: './distribution.css',
})
export class DistributionComponent implements AfterViewInit {
  // ── SVG geometry ──────────────────────────────────────────────────────────
  readonly W = 600;
  readonly H = 300;
  readonly AX = 34;     // left gutter (y tick labels)
  readonly PADR = 14;   // right pad
  readonly PADT = 20;   // top pad (count labels)
  readonly baseY = 246; // x baseline (leaves room for two-line x labels)

  @Input({ required: true }) set territories(v: TerritoryListItem[]) { this._terr.set(v ?? []); }
  // Brand filter is owned by the comparison table; changing it resets the user's
  // band pick so the default (worst non-empty band) shows for the new scope.
  @Input() set brandId(v: number | null) { this._brand.set(v ?? null); this._userBand.set(null); }
  @Output() select = new EventEmitter<TerritoryListItem>();

  private readonly _terr = signal<TerritoryListItem[]>([]);
  private readonly _brand = signal<number | null>(null);
  private readonly _userBand = signal<HealthBand | null>(null);
  readonly mounted = signal(false);

  readonly colW = (this.W - this.AX - this.PADR) / BANDS.length;

  readonly filtered = computed(() => {
    const b = this._brand();
    const all = this._terr();
    return b === null ? all : all.filter((t) => t.brandId === b);
  });

  // count per band, in worst→best order
  private readonly counts = computed<Record<HealthBand, TerritoryListItem[]>>(() => {
    const acc = { critical: [], warning: [], fair: [], good: [], strong: [] } as Record<HealthBand, TerritoryListItem[]>;
    for (const t of this.filtered()) acc[band(t.compositeScore)].push(t);
    return acc;
  });

  readonly stats = computed(() => {
    const scores = this.filtered().map((t) => t.compositeScore).sort((a, b) => a - b);
    const n = scores.length;
    if (!n) return { median: 0, mean: 0, belowFloor: 0, total: 0 };
    const mid = Math.floor(n / 2);
    const median = n % 2 ? scores[mid] : Math.round((scores[mid - 1] + scores[mid]) / 2);
    const mean = Math.round(scores.reduce((a, b) => a + b, 0) / n);
    const belowFloor = scores.filter((s) => s < 50).length;
    return { median, mean, belowFloor, total: n };
  });

  readonly ticks = computed<GridTick[]>(() => {
    const max = this.maxCount();
    const step = max <= 5 ? 1 : Math.ceil(max / 5);
    const out: GridTick[] = [];
    for (let v = 0; v <= max; v += step) {
      out.push({ value: v, y: this.baseY - (v / max) * (this.baseY - this.PADT) });
    }
    return out;
  });

  private maxCount(): number {
    const c = this.counts();
    return Math.max(1, ...BANDS.map((b) => c[b].length));
  }

  readonly bars = computed<Bar[]>(() => {
    const c = this.counts();
    const max = this.maxCount();
    const plotH = this.baseY - this.PADT;
    const barW = this.colW * 0.5;
    return BANDS.map((b, i) => {
      const count = c[b].length;
      const h = (count / max) * plotH;
      const cx = this.AX + this.colW * i + this.colW / 2;
      const y = this.baseY - h;
      return {
        i, band: b, label: BAND_LABEL[b], range: BAND_RANGE[b], count,
        barX: cx - barW / 2, barW, cx, y, h, labelY: Math.max(this.PADT + 4, y - 8),
        color: bandHex(b),
      };
    });
  });

  // Active band: the user's pick if it has territories, else the worst non-empty
  // band (so the at-risk tail is shown by default — that's where action lives).
  readonly activeBand = computed<HealthBand>(() => {
    const c = this.counts();
    const picked = this._userBand();
    if (picked && c[picked].length) return picked;
    const firstNonEmpty = BANDS.find((b) => c[b].length);
    return firstNonEmpty ?? 'critical';
  });

  readonly drillItems = computed(() =>
    [...this.counts()[this.activeBand()]].sort((a, b) => b.compositeScore - a.compositeScore),
  );

  readonly scopeLabel = computed(() => {
    const b = this._brand();
    if (b === null) return `All brands · ${this.stats().total} territories`;
    const name = this._terr().find((t) => t.brandId === b)?.brandName ?? 'Brand';
    return `${name} · ${this.stats().total} territories`;
  });

  ngAfterViewInit(): void {
    requestAnimationFrame(() => requestAnimationFrame(() => this.mounted.set(true)));
  }

  pick(b: HealthBand): void { this._userBand.set(b); }

  // Template helpers (delegate to the shared health/brand language).
  bandHex(b: HealthBand): string { return bandHex(b); }
  bandLabel(b: HealthBand): string { return BAND_LABEL[b]; }
  healthColor(v: number): string { return healthColor(v); }
  accent(id: number): string { return brandAccent(id); }
  medianColor(): string { return healthColor(this.stats().median); }
  meanColor(): string { return healthColor(this.stats().mean); }
}
