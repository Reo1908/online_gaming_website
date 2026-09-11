import { Injectable, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import type { LiveZustand } from './models';

/**
 * Die Live-Verbindung in eine Partie.
 *
 * Der Zustand kommt als Ganzes vom Server, sobald sich etwas Strukturelles
 * aendert (Beitritt, Buzzer, Punkte, Zug). Was sich dagegen dutzendfach je
 * Sekunde aendert -- getippter Text, ein Pinselstrich -- kommt einzeln und
 * wird hier nicht gespeichert, sondern an die Spielkomponente durchgereicht.
 *
 * Diese Klasse kennt deshalb kein Spiel: Sie fuehrt den Draht, nicht das Spiel.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private socket: Socket | null = null;

  private readonly aktuellerZustand = signal<LiveZustand | null>(null);
  private readonly verbindungSteht = signal(false);
  private readonly letzterFehler = signal<string | null>(null);

  readonly zustand = this.aktuellerZustand.asReadonly();
  readonly verbunden = this.verbindungSteht.asReadonly();
  readonly fehler = this.letzterFehler.asReadonly();

  betreten(code: string): void {
    this.verlassen();
    this.letzterFehler.set(null);

    // Gleiche Origin wie die Seite: das Session-Cookie geht dadurch von
    // selbst mit, ein eigener Token waere nur eine zweite Baustelle.
    const socket = io({ path: '/api/socket.io', withCredentials: true });
    this.socket = socket;

    socket.on('connect', () => {
      this.verbindungSteht.set(true);
      socket.emit('partie:betreten', code);
    });

    socket.on('disconnect', () => this.verbindungSteht.set(false));

    socket.on('connect_error', () => {
      this.verbindungSteht.set(false);
      this.letzterFehler.set('Keine Live-Verbindung. Die Seite verbindet sich neu.');
    });

    socket.on('zustand', (zustand: LiveZustand) => {
      this.aktuellerZustand.set(zustand);
      this.letzterFehler.set(null);
    });

    socket.on('fehler', ({ nachricht }: { nachricht: string }) => {
      this.letzterFehler.set(nachricht);
    });
  }

  verlassen(): void {
    this.socket?.close();
    this.socket = null;
    this.aktuellerZustand.set(null);
    this.verbindungSteht.set(false);
  }

  /** Schickt ein Ereignis an das Spielmodul auf dem Server. */
  senden(ereignis: string, nutzlast?: unknown): void {
    this.socket?.emit(ereignis, nutzlast);
  }

  /**
   * Horcht auf ein Ereignis der Spielart.
   *
   * Gibt eine Funktion zum Abmelden zurueck -- die Spielkomponente ruft sie
   * beim Verlassen. Ohne das blieben beim Wechsel zwischen zwei Partien die
   * alten Zuhoerer stehen und jedes Ereignis kaeme doppelt an.
   */
  horchen<T>(ereignis: string, tun: (daten: T) => void): () => void {
    const socket = this.socket;
    if (!socket) return () => undefined;

    socket.on(ereignis, tun as (...args: unknown[]) => void);
    return () => socket.off(ereignis, tun as (...args: unknown[]) => void);
  }

  /**
   * Setzt ein Feld eines Teilnehmers im vorhandenen Zustand.
   *
   * Fuer die kleinen Einzelmeldungen, die nicht den ganzen Zustand nach sich
   * ziehen sollen -- beim Buzzer der getippte Text.
   */
  teilnehmerSetzen(userId: string, felder: Record<string, unknown>): void {
    this.aktuellerZustand.update((alt) =>
      alt
        ? {
            ...alt,
            teilnehmer: alt.teilnehmer.map((t) => (t.userId === userId ? { ...t, ...felder } : t)),
          }
        : alt,
    );
  }

  /** Ersetzt einen Teil des spielabhaengigen Zustands, ohne auf den Server zu warten. */
  spielZustandSetzen(felder: Record<string, unknown>): void {
    this.aktuellerZustand.update((alt) =>
      alt
        ? {
            ...alt,
            spielZustand: { ...(alt.spielZustand as object | null), ...felder },
          }
        : alt,
    );
  }
}
