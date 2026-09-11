import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Reserviert fuer signierte Cookies; muss lang genug sein, um nicht ratbar zu sein.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET muss mindestens 32 Zeichen lang sein'),
  APP_ORIGIN: z.string().url().default('http://localhost:4200'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /**
   * Welchen vorgelagerten Adressen zu glauben ist, wenn sie in
   * X-Forwarded-For eine Client-IP behaupten. Massgeblich fuer die IP, auf die
   * das Rate-Limit schluesselt: ohne diesen Wert sieht Fastify hinter nginx
   * immer nur dessen Container-IP -- alle Besucher teilten sich dann einen
   * einzigen Topf und koennten sich gegenseitig aussperren.
   *
   * "uniquelocal" deckt die privaten Netze ab (10/8, 172.16/12, 192.168/16)
   * und damit sowohl den nginx aus dem web-Dienst als auch einen TLS-Proxy auf
   * demselben Rechner. Die erste oeffentliche Adresse von rechts gilt als
   * Besucher -- die kann sich niemand selbst ausdenken, weil nginx die echte
   * Verbindungsadresse anhaengt.
   *
   * Erlaubt sind ausserdem "loopback", einzelne IPs und CIDR-Bereiche,
   * mehrere durch Komma getrennt. Leer lassen schaltet die Auswertung ab;
   * dann zaehlt die Adresse der Verbindung selbst.
   *
   * Bewusst keine Hop-Zahl: Fastify lehnt die ab, weil sich damit der direkte
   * Gegenueber nicht pruefen laesst.
   */
  TRUST_PROXY: z.string().default('uniquelocal'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Ungültige Umgebungsvariablen:');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';

/**
 * Ob das Session-Cookie das Secure-Flag bekommt. Massgeblich ist, wie der
 * Browser die Seite aufruft -- nicht, ob NODE_ENV auf "production" steht.
 * Hinter einem TLS-Proxy spricht die Anwendung selbst oft nur HTTP, die
 * Verbindung zum Browser ist trotzdem verschluesselt: dann ist APP_ORIGIN
 * https und das Flag korrekt gesetzt.
 */
export const cookiesBrauchenHttps = env.APP_ORIGIN.startsWith('https://');

if (isProduction && !cookiesBrauchenHttps) {
  console.warn(
    `WARNUNG: APP_ORIGIN ist "${env.APP_ORIGIN}" (kein HTTPS). Das Session-Cookie ` +
      'wird ohne Secure-Flag ausgeliefert und kann im Netz mitgelesen werden. ' +
      'Fuer den echten Betrieb gehoert ein TLS-Proxy davor.',
  );
}
