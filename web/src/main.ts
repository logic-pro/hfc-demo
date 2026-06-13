import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppShell } from './app/app-shell';

// Bootstrap the routed shell; the booking demo (App) is now the '' route and is
// otherwise unchanged.
bootstrapApplication(AppShell, appConfig)
  .catch((err) => console.error(err));
