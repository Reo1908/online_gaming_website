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
      routes/   health, auth, leaderboard, matches, admin, support
  web/          Angular 21 + PrimeNG
    src/app/
      core/     Services, Guards, Interceptor, Typen
      pages/    home, login, leaderboard, profile, admin, status
```

### Datenmodell

| Modell | Wofür |
|---|---|
| `User` | Konto mit Rolle (`ADMIN` / `PLAYER`), Status und Sichtbarkeit |
| `Session` | Serverseitige Anmeldung, speichert nur den Token-Hash |
| `Game` | Eine Spielart, z. B. „Vier gewinnt" — nicht eine einzelne Partie |
| `Match` | Eine konkrete Partie: `LOBBY` → `RUNNING` → `FINISHED` / `ABORTED`, mit Beitrittscode und Einstellungen |
| `MatchPlayer` | Teilnahme eines Benutzers an einer Partie, mit Ergebnis; eine davon ist die Spielleitung |
| `OverallStat` | Bilanz über alle Spiele hinweg, Grundlage der Rangliste |
| `AuditLog` | Wer hat wann an welchem Konto was geändert — und warum |

Drei Entscheidungen, die beim Weiterbauen wichtig sind:

- **Ein Benutzer mit Partien lässt sich nicht löschen.** `MatchPlayer` hängt mit
  `onDelete: Restrict` am Benutzer — sonst blieben abgeschlossene Partien mit
  einem fehlenden Gegner zurück. Die Verwaltung antwortet in dem Fall mit einer
  Erklärung und dem Hinweis, das Konto stattdessen zu deaktivieren.
- **`OverallStat` wird fortgeschrieben, nicht berechnet.** Beim Ende einer
  Partie werden die Zähler erhöht, statt für jede Anzeige der Rangliste alle
  Partien neu zusammenzuzählen.
- **Aktiv und sichtbar sind zwei Schalter.** `isActive` entscheidet über die
  Anmeldung, `isVisible` allein über die Rangliste. Ein Test- oder
  Verwaltungskonto kann so mitspielen, ohne in der Wertung aufzutauchen.

Noch nicht angelegt: `GameStat` (Bilanz je Spiel).

Im `AuditLog` stehen Benutzername von Auslöser und Betroffenem zusätzlich als
Momentaufnahme. Die Verweise werden beim Löschen eines Kontos auf leer gesetzt —
ohne diese Kopien wäre danach nicht mehr erkennbar, um wen es ging.

### Endpunkte

| Methode | Pfad | Zugriff |
|---|---|---|
| GET | `/api/health` | offen |
| POST | `/api/auth/login` | offen |
| POST | `/api/auth/logout` | offen |
| GET | `/api/auth/me` | angemeldet |
| GET | `/api/auth/session` | offen |
| GET | `/api/leaderboard` | angemeldet |
| GET | `/api/games` | angemeldet |
| GET | `/api/matches` | angemeldet |
| POST | `/api/matches` | angemeldet |
| GET | `/api/matches/:code` | angemeldet |
| POST | `/api/matches/:code/join` | angemeldet |
| POST | `/api/matches/:code/leave` | angemeldet |
| POST | `/api/matches/:code/start` | Spielleitung |
| POST | `/api/matches/:code/finish` | Spielleitung |
| POST | `/api/matches/:code/abort` | Spielleitung |
| POST | `/api/auth/change-password` | angemeldet |
| GET | `/api/admin/status` | Administrator |
| GET | `/api/admin/users` | Administrator |
| GET | `/api/admin/users/:id/support` | Administrator |
| PATCH | `/api/admin/users/:id/stats` | Administrator |
| POST | `/api/admin/users` | Administrator |
| PATCH | `/api/admin/users/:id` | Administrator |
| DELETE | `/api/admin/users/:id` | Administrator |

---

## Wie eine Partie ablaeuft

Wer eine Lobby oeffnet, leitet sie: Die Spielleitung waehlt das Spiel, vergibt
einen Namen und stellt ein, wie viele Punkte ein Treffer bringt. Die Lobby zeigt
einen sechsstelligen Code, mit dem die anderen beitreten, solange sie wartet.

Beim Buzzer-Spiel gibt die Leitung eine Runde frei, alle anderen tippen ihre
Antwort und buzzern. Wer zuerst drueckt, steht oben — mit der Zeit seit der
Freigabe. Punkte vergibt allein die Leitung. Am Ende schreibt `finish` die
Ergebnisse fest und zaehlt die Bilanzen hoch; `abort` beendet ohne Wertung.

Die Spielleitung spielt nicht mit und taucht in keiner Wertung auf. Gewertet
wird ab zwei Mitspielenden — sonst gewaenne ein einzelner Spieler jede Partie
gegen sich selbst.

### Der Live-Teil

Getippter Text, Buzzer und Punktestand laufen ueber Socket.IO unter
`/api/socket.io` — derselbe Pfad wie die REST-Aufrufe, damit nginx im Betrieb
und der Angular-Proxy in der Entwicklung ohne eine zweite Weiterleitung
auskommen. Angemeldet wird der Socket ueber dasselbe Session-Cookie.

Was waehrend einer Runde entsteht, bleibt im Arbeitsspeicher der API: bei jedem
Tastendruck in die Datenbank zu schreiben waere teuer und ohne Nutzen. Punkte,
Teilnehmer und Status stehen dagegen sofort in der Datenbank. Ein Neustart der
API kostet also die laufende Runde, nicht den Spielstand.

Die Antworten sieht standardmaessig nur die Spielleitung. Dafuer sitzen Leitung
und Mitspieler in getrennten Socket-Raeumen — die Mitspieler bekommen den Text
der anderen gar nicht erst geschickt, statt ihn nur auszublenden.

Ein neues Spiel kommt in `apps/api/src/lib/spiele.ts` dazu: Eintrag in
`SPIELARTEN` mit einem Zod-Schema fuer seine Einstellungen. Die Tabelle `Game`
wird daraus beim Start abgeglichen, das Formular im Frontend nimmt die
Standardwerte von dort.

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

Auch hier gibt es noch kein Konto: der Seed unten läuft genauso, nur mit
`-f compose.prod.yml` statt `-f compose.deploy.yml`.

### Auf einem Server

Dort werden nur `compose.deploy.yml` und eine `.env` gebraucht, kein Quelltext:

```bash
docker compose -f compose.deploy.yml pull
docker compose -f compose.deploy.yml up -d
```

Die `.env` gehört nicht ins Repo, existiert auf dem Server aber trotzdem — sie
wird dort einmal von Hand angelegt. `.env.example` ist die Vorlage dafür; die
Geheimnisse kommen getrennt dorthin (Passwortmanager, `scp`), nie über git.

Der Stack bringt **Caddy** als TLS-Endpunkt mit. Er holt das Zertifikat bei
Let's Encrypt selbst und erneuert es auch selbst. Nötig sind dafür nur zwei
Dinge:

- ein DNS-Eintrag, der `PUBLIC_DOMAIN` auf die öffentliche Adresse des Servers
  zeigt (A-Record, bei IPv6 zusätzlich AAAA),
- Port **80 und 443** von außen erreichbar. Let's Encrypt prüft über genau
  diese beiden; ist 80 zu, kommt kein Zertifikat zustande.

`APP_ORIGIN` muss dieselbe Domain sein, mit `https://` davor und ohne
Schrägstrich am Ende. Die Anwendung selbst bleibt unveröffentlicht: `WEB_PORT`
bindet per Vorgabe auf `127.0.0.1`, erreichbar ist von außen nur Caddy.

Ob es geklappt hat, steht im Log — beim ersten Start dauert die Ausstellung
ein paar Sekunden:

```bash
docker compose -f compose.deploy.yml logs caddy
```

Das Zertifikat liegt im Volume `caddy_data`. Das muss bleiben: ohne es beantragt
Caddy nach jedem Neustart ein neues und läuft irgendwann in die
Ausstellungsgrenzen von Let's Encrypt.

> Wer schon einen eigenen Proxy betreibt, löscht den `caddy`-Dienst aus
> `compose.deploy.yml` und setzt `WEB_PORT` auf den Port, den dieser anspricht.

`IMAGE_TAG` in der `.env` bestimmt die Version. Zurückrollen heißt: alten Tag
eintragen, Befehle wiederholen.

#### Ersten Administrator anlegen

Migrationen laufen bei jedem Start von allein, der erste Benutzer nicht — auf
einem frischen Server gibt es also zunächst kein einziges Konto. Dafür in der
`.env` kurzzeitig die beiden Bootstrap-Zeilen eintragen (sie stehen
auskommentiert in `.env.example`):

```bash
ADMIN_BOOTSTRAP_USERNAME=sysadmin
ADMIN_BOOTSTRAP_PASSWORD=mindestens-12-zeichen
```

Dann einmalig einen Wegwerf-Container starten:

```bash
docker compose -f compose.deploy.yml run --rm api node dist/prisma/seed.js
```

Danach die beiden Zeilen wieder aus der `.env` entfernen und
`docker compose -f compose.deploy.yml up -d` wiederholen — so stehen sie auch
nicht mehr in der Umgebung des laufenden Containers. Zum Schluss unter
`/profile` anmelden und das Passwort ändern.

Zwei Stolpersteine dabei:

- **`node dist/prisma/seed.js`, nicht `npx tsx prisma/seed.ts`.** Der Befehl aus
  dem Schnellstart gilt nur für die Entwicklung — im Produktions-Image ist `tsx`
  als Dev-Abhängigkeit entfernt.
- **Der Seed ist kein Passwort-Reset.** Ein erneuter Lauf setzt bei einem
  bestehenden Konto nur Rolle und Status, das Passwort bleibt unangetastet. Ein
  vergessenes Admin-Passwort lässt sich nur noch von Hand in der Datenbank
  ersetzen; ein zweites Administratorkonto erspart genau das.

#### Vor dem Scharfschalten

Sechs Dinge, die auf dem Server erledigt sein sollten — die ersten drei, bevor
jemand anderes die Adresse bekommt:

1. **`PUBLIC_DOMAIN` und `APP_ORIGIN` müssen zusammenpassen.** Dieselbe Domain,
   einmal ohne und einmal mit `https://`, kein Schrägstrich am Ende. Das
   `Secure`-Flag des Session-Cookies hängt an `APP_ORIGIN`, nicht an
   `NODE_ENV`: Steht dort `https`, läuft die Seite aber über `http`, verwirft
   der Browser das Cookie kommentarlos — der Login scheint zu klappen und ist
   sofort wieder weg.
2. **`WEB_PORT` auf `127.0.0.1:8080` lassen.** Nach außen gehört nur Caddy.
   Ein öffentlich veröffentlichter Port wäre nicht nur unverschlüsselt
   erreichbar, er ließe auch den Weg an Caddy vorbei offen — und damit eine
   selbst behauptete `X-Forwarded-For` (siehe Punkt 3).
3. **`TRUST_PROXY` prüfen.** Der Standard `uniquelocal` passt für den üblichen
   Aufbau: nginx im web-Dienst, davor ein TLS-Proxy auf demselben Rechner.
   Stimmt der Wert nicht, sieht die API bei jedem Aufruf dieselbe Proxy-IP —
   dann teilen sich **alle** Besucher ein Rate-Limit und sperren sich
   gegenseitig aus (10 Loginversuche pro Minute für die ganze Seite).
   Gegenprobe im Log: `docker compose -f compose.deploy.yml logs api` muss bei
   `remoteAddress` die echte Besucher-IP zeigen, nicht `172.x.x.x`. Caddy
   verwirft eine vom Besucher selbst mitgeschickte `X-Forwarded-For` und setzt
   die tatsächliche Absenderadresse ein — solange niemand an Caddy vorbeikommt,
   lässt sich das Rate-Limit also nicht austricksen.
4. **An der Registry anmelden.** Pakete auf ghcr sind standardmäßig privat, dann
   scheitert `pull` mit „denied". Entweder beide Pakete auf GitHub öffentlich
   stellen oder einmalig anmelden:
   ```bash
   echo <PAT mit read:packages> | docker login ghcr.io -u <GitHub-Name> --password-stdin
   ```
5. **Sicherung einrichten.** Alle Konten und Ergebnisse liegen im Volume
   `postgres_data`; ein `down -v` löscht es. Ein nächtlicher Dump reicht — die
   Zugangsdaten holt sich der Befehl aus dem Container, damit er auch nach einem
   Wechsel von `POSTGRES_USER`/`POSTGRES_DB` noch stimmt:
   ```bash
   docker compose -f compose.deploy.yml exec -T db \r
     sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "sicherung-$(date +%F).sql.gz"
   ```
   Zurückspielen:
   ```bash
   gunzip -c sicherung-2026-09-11.sql.gz | docker compose -f compose.deploy.yml exec -T db \r
     sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```
6. **Zweites Administratorkonto anlegen**, solange du angemeldet bist. Der Seed
   setzt kein bestehendes Passwort zurück — ohne zweiten Zugang wäre ein
   vergessenes Admin-Passwort nur noch von Hand in der Datenbank zu ersetzen.

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
