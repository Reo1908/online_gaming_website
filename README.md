# Friend Games

Spieleplattform für den Freundeskreis. Angular im Frontend, Fastify im Backend,
PostgreSQL als Datenbank — alles in Containern.

---

## Schnellstart

Du brauchst nur **Docker Desktop**. Node musst du lokal nicht installieren.

```bash
git clone https://github.com/Reo1908/online_gaming_website.git
cd online_gaming_website

cp apps/api/.env.example apps/api/.env
```

In `apps/api/.env` zwei Werte eintragen:

```bash
# Geheimnis erzeugen (mindestens 32 Zeichen):
docker run --rm node:22-slim node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- `SESSION_SECRET` — die Ausgabe von oben
- `ADMIN_BOOTSTRAP_PASSWORD` — dein Wunschpasswort, mindestens 12 Zeichen

Dann starten:

```bash
docker compose up -d
```

Ersten Administrator anlegen (einmalig):

```bash
docker compose exec api npx tsx prisma/seed.ts
```

Fertig:

| | |
|---|---|
| Frontend | http://localhost:4200 |
| Backend | http://localhost:3000 |
| Datenbank | localhost:5432 |

---

## Tägliche Befehle

```bash
docker compose up -d        # starten
docker compose logs -f      # mitlesen
docker compose logs -f api  # nur das Backend
docker compose down         # stoppen
docker compose restart api  # einzelnen Dienst neu starten
```

### Wann muss ich neu bauen?

Beim Ändern von Code **gar nicht** — Änderungen in `src/` greifen sofort
(Backend nach ca. 3 Sekunden, Frontend nach ca. einer halben).

| Geändert | Nötig |
|---|---|
| Code in `src/` | nichts |
| `package.json` | `docker compose up -d --build` |
| `Dockerfile`, `compose.yml` | `docker compose up -d --build` |
| `prisma/schema.prisma` | siehe Datenbank |

Nur `src/` und `prisma/` werden in die Container gespiegelt, `node_modules`
absichtlich nicht: `argon2` und die Prisma-Engine sind dort für Linux übersetzt
und würden von einer Windows-Version überdeckt und unbrauchbar.

---

## Datenbank

```bash
# Nach einer Änderung an prisma/schema.prisma
docker compose exec api npx prisma migrate dev --name beschreibender_name

# Direkt per SQL
docker compose exec db psql -U friendgames -d friendgames
```

Bestehende Migrationen werden bei jedem Containerstart automatisch eingespielt.

### Daten ansehen (Prisma Studio)

Prisma Studio ist eine Weboberfläche für die Datenbank. Sie gehört nicht zum
Stack und läuft nur, wenn man sie startet:

```bash
docker compose run --rm -p 5555:5555 api npx prisma studio --hostname 0.0.0.0 --browser none
```

Danach unter http://localhost:5555 erreichbar, Beenden mit `Strg+C`.

Beide Zusätze sind nötig: `--hostname 0.0.0.0` lässt Studio Verbindungen von
außerhalb des Containers annehmen — ohne das ist es trotz veröffentlichtem Port
nicht erreichbar. `--browser none` verhindert den Versuch, im Container einen
Browser zu öffnen.

`docker compose exec api npx prisma studio` funktioniert **nicht**: Der
api-Dienst veröffentlicht nur Port 3000, Studio bliebe im Container eingesperrt.

Alternativ ohne Container, falls Node lokal installiert ist:

```bash
cd apps/api && npm run db:studio
```

Läuft dann direkt auf dem Rechner und belegt ebenfalls Port 5555 — beide
Varianten gleichzeitig gehen also nicht.

> **Achtung:** `docker compose down -v` löscht das Datenbank-Volume und damit
> alle Benutzer. Ohne `-v` bleiben die Daten erhalten.

---

## Ohne Container arbeiten

Falls du Angular oder Fastify doch einmal direkt laufen lassen willst:

```bash
docker compose up -d db                 # nur die Datenbank
cd apps/api && npm install && npm run dev
cd apps/web && npm install && npm start
```

---

## Aufbau

```
apps/
  api/          Fastify + Prisma
    prisma/     Schema und Migrationen
    src/
      lib/      Datenbank, Passwörter, Sessions, Guards
      routes/   health, auth, admin
  web/          Angular 21 + PrimeNG
    src/app/
      core/     Services, Guards, Interceptor, Typen
      pages/    home, login, profile, admin, status
```

### Datenmodell

| Modell | Wofür |
|---|---|
| `User` | Konto mit Rolle (`ADMIN` / `PLAYER`) |
| `Session` | Serverseitige Anmeldung, speichert nur den Token-Hash |
| `Game` | Eine Spielart, z. B. „Vier gewinnt" — nicht eine einzelne Partie |
| `Match` | Eine konkrete Partie: `LOBBY` → `RUNNING` → `FINISHED` / `ABORTED` |
| `MatchPlayer` | Teilnahme eines Benutzers an einer Partie, mit Ergebnis |
| `OverallStat` | Bilanz über alle Spiele hinweg, Grundlage der Rangliste |

Zwei Entscheidungen, die beim Weiterbauen wichtig sind:

- **Ein Benutzer mit Partien lässt sich nicht löschen.** `MatchPlayer` hängt mit
  `onDelete: Restrict` am Benutzer — sonst blieben abgeschlossene Partien mit
  einem fehlenden Gegner zurück. Die Verwaltung antwortet in dem Fall mit einer
  Erklärung und dem Hinweis, das Konto stattdessen zu deaktivieren.
- **`OverallStat` wird fortgeschrieben, nicht berechnet.** Beim Ende einer
  Partie werden die Zähler erhöht, statt für jede Anzeige der Rangliste alle
  Partien neu zusammenzuzählen.

Noch nicht angelegt: `GameStat` (Bilanz je Spiel) und `AuditLog`.

### Endpunkte

| Methode | Pfad | Zugriff |
|---|---|---|
| GET | `/api/health` | offen |
| POST | `/api/auth/login` | offen |
| POST | `/api/auth/logout` | offen |
| GET | `/api/auth/me` | angemeldet |
| GET | `/api/auth/session` | offen |
| POST | `/api/auth/change-password` | angemeldet |
| GET | `/api/admin/status` | Administrator |
| GET | `/api/admin/users` | Administrator |
| POST | `/api/admin/users` | Administrator |
| PATCH | `/api/admin/users/:id` | Administrator |
| DELETE | `/api/admin/users/:id` | Administrator |

---

## Wie die Anmeldung funktioniert

Serverseitige Sessions statt JWT. Wichtig zu wissen:

- Passwörter werden mit **Argon2id** gehasht, niemals im Klartext gespeichert.
- In der Session-Tabelle liegt nur der **SHA-256-Hash** des Tokens. Aus einem
  Datenbank-Leak lässt sich damit keine fremde Sitzung übernehmen.
- Das Cookie ist `httpOnly` (für JavaScript unsichtbar) und `SameSite=Lax`.
- Deshalb laufen Frontend und Backend über **dieselbe Origin** — im Betrieb
  reicht nginx `/api` an das Backend weiter, in der Entwicklung der
  Angular-Proxy. Läge die API auf einem anderen Host, sendete der Browser das
  Cookie nicht mehr mit.
- Das `Secure`-Flag hängt an `APP_ORIGIN`. Steht dort `https://`, wird es
  gesetzt. **Ohne HTTPS im echten Betrieb verwirft der Browser das Cookie
  kommentarlos** und niemand bleibt angemeldet.
- **Angular-Guards sind keine Sicherheitsmaßnahme.** Sie blenden nur die
  Oberfläche aus. Verbindlich ist allein die Prüfung im Backend.

Es gibt keine Selbstregistrierung — Konten legt ein Administrator unter
`/admin` an. Sein Passwort kann jeder unter `/profile` selbst ändern.

---

## Veröffentlichen

Bei jedem Push auf `main` baut GitHub Actions beide Images und lädt sie nach
`ghcr.io` hoch. Es ist nichts einzurichten.

```bash
git tag v1.0.0 && git push --tags   # feste Version markieren
```

### Produktionsaufbau lokal testen

```bash
cp .env.example .env     # SESSION_SECRET eintragen!
docker compose -f compose.prod.yml up -d --build
```

Läuft dann auf http://localhost:8080 — Angular wird gebaut und von nginx
ausgeliefert, kein Dev-Server.

### Auf einem Server

Dort werden nur `compose.deploy.yml` und eine `.env` gebraucht, kein Quelltext:

```bash
docker compose -f compose.deploy.yml pull
docker compose -f compose.deploy.yml up -d
```

`IMAGE_TAG` in der `.env` bestimmt die Version. Zurückrollen heißt: alten Tag
eintragen, Befehle wiederholen.

> Für den echten Betrieb gehört ein TLS-Proxy davor (Caddy, Traefik, nginx).
> Ohne HTTPS wandern Passwörter und Session-Cookies im Klartext durchs Netz.

---

## Konfiguration

| Datei | Wofür |
|---|---|
| `apps/api/.env` | Entwicklung — Datenbank, Geheimnis, erster Admin |
| `.env` (Wurzel) | Nur `compose.prod.yml` und `compose.deploy.yml` |

Beide sind per `.gitignore` ausgeschlossen. Als Vorlage dienen die
`.env.example`-Dateien daneben.

| Compose-Datei | Wofür |
|---|---|
| `compose.yml` | Entwicklung, mit sofortiger Übernahme von Änderungen |
| `compose.prod.yml` | Produktionsaufbau lokal bauen und testen |
| `compose.deploy.yml` | Server, zieht fertige Images aus der Registry |
