import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'hfc-theme';

/**
 * Single source of truth for the active theme. The actual <html data-theme>
 * is set BEFORE first paint by the inline boot script in index.html (no flash);
 * this service mirrors that initial value, then owns subsequent toggles.
 *
 * Resolution order on load: explicit user choice (localStorage) → OS
 * prefers-color-scheme. A toggle persists the choice and overrides the OS.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _theme = signal<Theme>(this.resolveInitial());
  /** Reactive current theme — drives the toggle's aria-pressed / glyph. */
  readonly theme = this._theme.asReadonly();

  private resolveInitial(): Theme {
    // Prefer what the boot script already committed to the DOM so we never drift.
    const attr = typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-theme')
      : null;
    if (attr === 'light' || attr === 'dark') return attr;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch { /* storage unavailable */ }

    const prefersDark = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  /** Apply + persist a theme. */
  set(theme: Theme): void {
    this._theme.set(theme);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }

  /** Flip and persist. */
  toggle(): void {
    this.set(this._theme() === 'dark' ? 'light' : 'dark');
  }
}
