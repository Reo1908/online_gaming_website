import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    // Ohne Anmeldung ist ausser /login nichts erreichbar. Der Guard schickt
    // Unangemeldete dorthin und merkt sich das urspruengliche Ziel.
    canActivate: [authGuard],
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
    title: 'Friend Games',
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
    title: 'Anmelden',
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile),
    title: 'Profil',
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin),
    title: 'Administration',
  },
  {
    path: 'status',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/status/status').then((m) => m.Status),
    title: 'Systemstatus',
  },
  { path: '**', redirectTo: '' },
];
