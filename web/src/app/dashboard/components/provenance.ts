import {
  AfterViewInit, ChangeDetectionStrategy, Component, EventEmitter, Input, Output,
  computed, signal,
} from '@angular/core';
import { DataNote, ProvenanceType, VitalSign } from '../dashboard.models';
import { PROVENANCE_BLURB, PROVENANCE_LABEL } from '../ui/health';

interface PlaneVm {
  type: ProvenanceType;
  label: string;
  blurb: string;
  count: number;
  pct: number;
  asOf: string | null;
  present: boolean;
}

// D16 — the provenance/data-quality visual: the product's honesty story made an
// explicit, interactive feature instead of fine print. Three planes, each in its
// OWN colour language (the prov palette — never the health scale): what we
// MEASURED from operations, what franchisees REPORTED through royalty/billing, and
// what is ILLUSTRATIVE/seeded. Selecting a plane re-skins the hero-8 above —
// matching tiles stay lit, the rest dim — so "which of these numbers are real?" is
// answered with a click. The Reported plane is deliberately empty in the demo, and
// that emptiness is the point: no reported royalty data this cycle is precisely why
// every financial sub-score reads "pending." We show the gap; we never fake it.
@Component({
  selector: 'ec-provenance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card prov-card">
      <header class="prov-head">
        <div class="prov-title">
          <span class="eyebrow">Data Provenance · Measured vs Reported</span>
          <h2>Which of these numbers are real?</h2>
        </div>
        <div class="seg" role="group" aria-label="Highlight vital signs by data source">
          <button class="seg-btn" [class.on]="selected === null" (click)="all()">All</button>
          @for (p of planes(); track p.type) {
            <button
              class="seg-btn"
              [attr.data-prov]="p.type"
              [class.on]="selected === p.type"
              (click)="pick(p.type)"
              [attr.aria-pressed]="selected === p.type"
              [attr.title]="p.count + ' ' + p.label + ' vital signs'"
            >
              <span class="seg-dot"></span>{{ p.label }}<span class="seg-n tnum">{{ p.count }}</span>
            </button>
          }
        </div>
      </header>

      <!-- Coverage bar — measured/illustrative split at a glance; segments drill too. -->
      <div class="cov">
        <div class="cov-bar">
          @for (s of segments(); track s.type) {
            <span
              class="cov-seg"
              [attr.data-prov]="s.type"
              [class.dim]="selected !== null && selected !== s.type"
              [style.flex-basis.%]="mounted() ? s.pct : 0"
              (click)="pick(s.type)"
              [attr.title]="s.count + ' ' + s.label + ' · ' + s.pct + '%'"
            >
              <span class="cov-lab tnum">{{ s.pct }}%</span>
            </span>
          }
        </div>
        <p class="cov-cap">
          <strong class="tnum">{{ measuredCount() }}</strong> of
          <strong class="tnum">{{ total() }}</strong> vital signs are measured directly
          from operations. <span class="cov-hint">Select a plane to highlight which tiles it powers.</span>
        </p>
      </div>

      <!-- Plane ledger — the three sources, their meaning, and their freshness. -->
      <ul class="planes">
        @for (p of planes(); track p.type) {
          <li
            class="plane"
            [attr.data-prov]="p.type"
            [class.on]="selected === p.type"
            [class.empty]="!p.present"
            (click)="pick(p.type)"
            (keydown.enter)="pick(p.type)"
            tabindex="0"
            role="button"
            [attr.aria-pressed]="selected === p.type"
            [attr.aria-label]="'Highlight ' + p.label + ' vital signs'"
          >
            <span class="plane-swatch"></span>
            <div class="plane-body">
              <div class="plane-top">
                <span class="plane-label">{{ p.label }}</span>
                <span class="plane-count tnum">{{ p.count }}</span>
              </div>
              <p class="plane-blurb">
                {{ p.blurb }}
                @if (!p.present) {
                  <span class="plane-gap">None received this cycle — financial sub-scores stay pending.</span>
                }
              </p>
            </div>
            <span class="plane-asof tnum">
              @if (p.asOf) { as of {{ p.asOf }} } @else { awaiting }
            </span>
          </li>
        }
      </ul>

      @if (dataNotes().length) {
        <div class="prov-notes">
          @for (n of dataNotes(); track n.message) {
            <p class="prov-note" [attr.data-sev]="n.severity">
              <span class="pn-icon" aria-hidden="true">i</span>{{ n.message }}
            </p>
          }
        </div>
      }
    </section>
  `,
  styleUrl: './provenance.css',
})
export class ProvenanceComponent implements AfterViewInit {
  @Input({ required: true }) set vitalSigns(v: VitalSign[]) { this._vs.set(v ?? []); }
  @Input() set notes(v: DataNote[]) { this._notes.set(v ?? []); }
  // Controlled by the dashboard so the same selection drives the hero re-skin.
  @Input() selected: ProvenanceType | null = null;
  @Output() planeChange = new EventEmitter<ProvenanceType | null>();

  private readonly _vs = signal<VitalSign[]>([]);
  private readonly _notes = signal<DataNote[]>([]);
  readonly mounted = signal(false);
  readonly dataNotes = this._notes;

  // Truth → awaited → illustrative. Also descending confidence — reads top-down.
  private static readonly ORDER: ProvenanceType[] = ['measured', 'reported', 'seeded'];

  readonly total = computed(() => this._vs().length);

  readonly planes = computed<PlaneVm[]>(() => {
    const vs = this._vs();
    const denom = vs.length || 1;
    return ProvenanceComponent.ORDER.map((type) => {
      const inPlane = vs.filter((v) => v.provenanceType === type);
      // ISO YYYY-MM-DD sorts lexically → last is freshest.
      const dates = inPlane.map((v) => v.asOfDate).sort();
      return {
        type,
        label: PROVENANCE_LABEL[type],
        blurb: PROVENANCE_BLURB[type],
        count: inPlane.length,
        pct: Math.round((inPlane.length / denom) * 100),
        asOf: dates.length ? dates[dates.length - 1] : null,
        present: inPlane.length > 0,
      };
    });
  });

  // Only planes that actually contribute width appear in the coverage bar. The
  // last segment absorbs the rounding remainder so the labels always sum to 100%.
  readonly segments = computed<PlaneVm[]>(() => {
    const present = this.planes().filter((p) => p.count > 0);
    let acc = 0;
    return present.map((p, i) => {
      const pct = i === present.length - 1 ? 100 - acc : p.pct;
      acc += pct;
      return { ...p, pct };
    });
  });
  readonly measuredCount = computed(() => this.planes().find((p) => p.type === 'measured')?.count ?? 0);

  ngAfterViewInit(): void {
    requestAnimationFrame(() => requestAnimationFrame(() => this.mounted.set(true)));
  }

  // Toggle: re-picking the active plane clears back to "All".
  pick(type: ProvenanceType): void {
    this.planeChange.emit(this.selected === type ? null : type);
  }
  all(): void { this.planeChange.emit(null); }
}
