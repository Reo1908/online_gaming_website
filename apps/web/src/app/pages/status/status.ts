import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../core/api.service';
import type { SystemStatus } from '../../core/models';

type Zustand =
  | { art: 'laedt' }
  | { art: 'ok'; daten: SystemStatus }
  | { art: 'fehler'; grund: string };

@Component({
  selector: 'app-status',
  imports: [DatePipe, ButtonModule, CardModule, TagModule],
  templateUrl: './status.html',
  styleUrl: './status.scss',
})
export class Status {
  private readonly api = inject(ApiService);

  protected readonly zustand = signal<Zustand>({ art: 'laedt' });

  constructor() {
    void this.laden();
  }

  protected async laden(): Promise<void> {
    this.zustand.set({ art: 'laedt' });
    try {
      this.zustand.set({ art: 'ok', daten: await firstValueFrom(this.api.systemStatus()) });
    } catch {
      // Deckt beide Faelle ab: Backend aus (Netzwerkfehler) und
      // Backend an, aber Antwort nicht verwertbar.
      this.zustand.set({ art: 'fehler', grund: 'Das Backend ist nicht erreichbar.' });
    }
  }

  /** 93784 Sekunden lesen sich als "1 T 2 Std 3 Min". */
  protected laufzeit(sekunden: number): string {
    const tage = Math.floor(sekunden / 86400);
    const stunden = Math.floor((sekunden % 86400) / 3600);
    const minuten = Math.floor((sekunden % 3600) / 60);

    const teile: string[] = [];
    if (tage) teile.push(`${tage} T`);
    if (stunden) teile.push(`${stunden} Std`);
    // Minuten immer zeigen, sonst stuende bei frischem Start nichts da.
    teile.push(`${minuten} Min`);

    return teile.join(' ');
  }
}
