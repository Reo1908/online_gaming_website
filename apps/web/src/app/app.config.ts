import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';
import { credentialsInterceptor } from './core/credentials.interceptor';
import { AuthService } from './core/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([credentialsInterceptor])),
    providePrimeNG({ theme: { preset: Aura } }),

    // Blockiert den Start, bis die Session geladen ist. Sonst wuerden die
    // Guards beim ersten Aufruf laufen, bevor der Benutzer bekannt ist,
    // und einen eingeloggten Benutzer faelschlich zum Login schicken.
    provideAppInitializer(() => inject(AuthService).restoreSession()),
  ],
};
