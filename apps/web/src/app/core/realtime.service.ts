import { Injectable, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import type { LiveZustand } from './models';

/**
 * Die Live-Verbindung in eine Partie.
 *
 * Der Zustand kommt als Ganzes vom Server, sobald sich etwas Strukturelles
 * aendert (Beitritt, Buzzer, Punkte, Runde). Nur der getippte Text kommt
 * einzeln -- er aendert sich bei jedem Tastendruck und wird hier in den
 * vorhandenen Zustand eingesetzt, statt jedes Mal alles neu zu schicken.
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

    socket.on('spieler:text', ({ userId, text }: { userId: string; text: string }) => {
      this.aktuellerZustand.update((alt) =>
        alt
          ? {
              ...alt,
              teilnehmer: alt.teilnehmer.map((t) => (t.userId === userId ? { ...t, text } : t)),
            }
          : alt,
      );
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

  textSenden(text: string): void {
    this.socket?.emit('text:setzen', { text });
  }

  buzzern(): void {
    this.socket?.emit('buzzern');
  }

  rundeStarten(): void {
    this.socket?.emit('runde:starten');
  }

  rundeStoppen(): void {
    this.socket?.emit('runde:stoppen');
  }

  punkteGeben(userId: string, punkte: number): void {
    this.socket?.emit('punkte:geben', { userId, punkte });
  }
}
