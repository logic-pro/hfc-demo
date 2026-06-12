import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from './api.service';
import { TenantService } from './tenant.service';
import { Appointment, Brand, Slot } from './models';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private api = inject(ApiService);
  private tenant = inject(TenantService);

  // ── View state as signals ───────────────────────────────────────────────
  readonly brands = signal<Brand[]>([]);
  readonly slots = signal<Slot[]>([]);
  readonly appointments = signal<Appointment[]>([]);
  readonly selectedBrandId = this.tenant.brandId; // signal, shared with interceptor
  readonly customerName = signal('Jane Doe');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  readonly selectedBrand = computed(() =>
    this.brands().find((b) => b.id === this.selectedBrandId()) ?? null,
  );
  readonly openSlots = computed(() => this.slots().filter((s) => !s.isBooked));

  ngOnInit(): void {
    this.api.brands().subscribe({
      next: (b) => this.brands.set(b),
      error: () => this.error.set('Could not reach the API. Is it running on :5180?'),
    });
  }

  selectBrand(id: string): void {
    this.tenant.select(id);
    this.error.set(null);
    this.notice.set(null);
    this.refresh();
  }

  // Parallel reads with forkJoin — both complete before we paint.
  private refresh(): void {
    if (!this.selectedBrandId()) return;
    this.loading.set(true);
    forkJoin({ slots: this.api.slots(), appointments: this.api.appointments() }).subscribe({
      next: ({ slots, appointments }) => {
        this.slots.set(slots);
        this.appointments.set(appointments);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load this brand’s schedule.');
        this.loading.set(false);
      },
    });
  }

  book(slot: Slot): void {
    this.notice.set(null);
    this.api
      .book({ slotId: slot.id, customerName: this.customerName(), service: 'In-home consult' })
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

  fmt(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
