# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build: erzeugt die statischen Dateien. Node wird nur hier gebraucht --
# im Ergebnis-Image ist kein Node mehr enthalten.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY angular.json tsconfig*.json ./
COPY src ./src
COPY public ./public

RUN npm run build


# ---------------------------------------------------------------------------
# Laufzeit: nur nginx und ein paar Kilobyte statische Dateien.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Der Application Builder legt das Ergebnis unter dist/<projekt>/browser ab.
COPY --from=build /app/dist/web/browser /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
