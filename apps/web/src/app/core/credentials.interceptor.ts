import type { HttpInterceptorFn } from '@angular/common/http';

/**
 * Das Session-Cookie ist httpOnly, also fuer JavaScript unsichtbar.
 * Der Browser haengt es nur an, wenn der Request `withCredentials` gesetzt hat --
 * ohne diesen Interceptor waere jeder Aufruf unauthentifiziert.
 */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api')) {
    return next(req);
  }
  return next(req.clone({ withCredentials: true }));
};
