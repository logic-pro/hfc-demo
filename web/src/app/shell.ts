import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// Root shell: a thin top nav + the routed view. Keeps the existing booking demo
// at '/' and mounts the operations dashboard at '/dashboard'.
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-screen bg-slate-50">
      <nav class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2 sm:px-6 lg:px-8">
          <span class="mr-4 text-sm font-semibold text-slate-900">HFC</span>
          <a routerLink="/" routerLinkActive="bg-slate-900 text-white"
             [routerLinkActiveOptions]="{ exact: true }"
             class="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Booking</a>
          <a routerLink="/dashboard" routerLinkActive="bg-slate-900 text-white"
             class="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Dashboard</a>
        </div>
      </nav>
      <router-outlet />
    </div>
  `,
})
export class Shell {}
