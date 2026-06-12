import { Injectable, signal } from '@angular/core';

// Single source of truth for "which brand am I acting as." The HTTP interceptor
// reads it to stamp X-Tenant-Id on every request, and the UI binds to it. A
// signal (not a BehaviorSubject) because this is synchronous view state.
@Injectable({ providedIn: 'root' })
export class TenantService {
  readonly brandId = signal<string | null>(null);

  select(id: string): void {
    this.brandId.set(id);
  }
}
