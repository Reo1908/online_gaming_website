import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Guards sind reiner Komfort: sie ersparen dem Benutzer eine Seite,
 * die der Server ohnehin mit 401/403 beantworten wuerde.
 * Sie sind ausdruecklich KEINE Sicherheitsmassnahme -- wer die URL kennt,
 * kann das Frontend umgehen und direkt die API aufrufen.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) return true;

  // Ziel merken, damit der Login danach zurueckspringen kann.
  return router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });
};

export const adminGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    return router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });
  }

  return auth.isAdmin() ? true : router.createUrlTree(['/profile']);
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Bereits eingeloggte Benutzer sollen nicht auf dem Login-Formular landen.
  return auth.isLoggedIn() ? router.createUrlTree(['/profile']) : true;
};
