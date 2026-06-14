import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from './api.service';
import { TenantService } from './tenant.service';
import { Appointment, Franchisee, IntakeDraft, Slot, TimeOfDay, Urgency } from './models';

@Component({
  selector: 'app-booking',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private api = inject(ApiService);
  private tenant = inject(TenantService);

  // ── View state as signals ───────────────────────────────────────────────
  readonly franchisees = signal<Franchisee[]>([]);
  readonly slots = signal<Slot[]>([]);
  readonly appointments = signal<Appointment[]>([]);
  readonly selectedFranchiseeId = this.tenant.franchiseeId; // signal, shared with interceptor
  readonly customerName = signal('Jane Doe');
  readonly service = signal('In-home consult'); // what gets booked; pre-filled by AI intake
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  // ── AI-assisted intake state ────────────────────────────────────────────
  readonly intakeText = signal('');
  readonly draft = signal<IntakeDraft | null>(null);
  readonly parsing = signal(false);
  readonly timeOptions: TimeOfDay[] = ['Any', 'Morning', 'Afternoon', 'Evening'];
  readonly urgencyOptions: Urgency[] = ['Routine', 'Soon', 'Emergency'];

  readonly selectedFranchisee = computed(() =>
    this.franchisees().find((f) => f.id === this.selectedFranchiseeId()) ?? null,
  );
  readonly openSlots = computed(() => this.slots().filter((s) => !s.isBooked));

  ngOnInit(): void {
    this.api.franchisees().subscribe({
      next: (f) => this.franchisees.set(f),
      error: () => this.error.set('Could not reach the API. Is it running on :5180?'),
    });
  }

  // Selecting a franchisee mints a scoped token (login stand-in), then loads the
  // tenant-isolated schedule. The server resolves the tenant from the token's
  // claim — same brand, different franchisee never leaks.
  selectFranchisee(f: Franchisee): void {
    this.error.set(null);
    this.notice.set(null);
    this.draft.set(null); // intake vocabulary is per-brand; start fresh on franchisee switch
    this.api.token(f.id).subscribe({
      next: (res) => {
        this.tenant.setSession(res.franchiseeId, res.brandId, res.token);
        this.refresh();
      },
      error: () => this.error.set('Could not sign in as that franchisee.'),
    });
  }

  // Free text -> typed draft. The backend caps spend/latency and degrades to a
  // local heuristic on failure, so this call always resolves to a usable draft.
  parseIntake(): void {
    const text = this.intakeText().trim();
    if (!text) return;
    this.parsing.set(true);
    this.error.set(null);
    this.api.parseIntake(text).subscribe({
      next: (d) => {
        this.draft.set(d);
        this.parsing.set(false);
      },
      error: () => {
        this.error.set('Intake parsing failed — type the booking in by hand.');
        this.parsing.set(false);
      },
    });
  }

  // Immutably patch one field of the draft as the human reviews/edits it.
  patchDraft<K extends keyof IntakeDraft>(key: K, value: IntakeDraft[K]): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, [key]: value });
  }

  // Commit the reviewed draft into the booking flow: its name + service become
  // what the next "Book" click uses. The draft stays visible as context.
  useDraft(): void {
    const d = this.draft();
    if (!d) return;
    if (d.customerName) this.customerName.set(d.customerName);
    this.service.set(d.service);
    this.notice.set(`Intake applied — booking as “${d.customerName ?? this.customerName()}” for “${d.service}”. Pick a slot below.`);
  }

  discardDraft(): void {
    this.draft.set(null);
    this.intakeText.set('');
  }

  // Parallel reads with forkJoin — both complete before we paint.
  private refresh(): void {
    if (!this.selectedFranchiseeId()) return;
    this.loading.set(true);
    forkJoin({ slots: this.api.slots(), appointments: this.api.appointments() }).subscribe({
      next: ({ slots, appointments }) => {
        this.slots.set(slots);
        this.appointments.set(appointments);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load this franchisee’s schedule.');
        this.loading.set(false);
      },
    });
  }

  book(slot: Slot): void {
    this.notice.set(null);
    this.api
      .book({ slotId: slot.id, customerName: this.customerName(), service: this.service() })
      .subscribe({
        next: () => {
          this.notice.set(`Booked ${slot.territoryName} @ ${this.fmt(slot.startUtc)}.`);
          this.refresh();
        },
        error: (e) => {
          // 409 = someone took the slot first (optimistic concurrency). Re-sync.
          this.error.set(e.status === 409 ? 'That slot was just taken — refreshed.' : 'Booking failed.');
          this.refresh();
        },
      });
  }

  payDeposit(appt: Appointment): void {
    // A fresh idempotency key per user-initiated attempt; a retried network
    // call reuses it so the customer is never charged twice.
    const key = crypto.randomUUID();
    this.api.deposit(appt.id, 5000, key).subscribe({
      next: () => {
        this.notice.set(`Deposit captured for appointment #${appt.id} (idempotency-key ${key.slice(0, 8)}…).`);
        this.refresh();
      },
      error: () => this.error.set('Deposit failed.'),
    });
  }

  pct(confidence: number): number {
    return Math.round(confidence * 100);
  }

  fmt(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
