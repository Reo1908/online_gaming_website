import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { HealthStatus } from '../../core/models';

type Probe =
  | { state: 'checking' }
  | { state: 'online'; health: HealthStatus }
  | { state: 'offline' };

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly probe = signal<Probe>({ state: 'checking' });

  constructor() {
    void this.check();
  }

  protected async check(): Promise<void> {
    this.probe.set({ state: 'checking' });
    try {
      const health = await firstValueFrom(this.api.health());
      this.probe.set({ state: 'online', health });
    } catch {
      // Deckt beide Faelle ab: Backend aus (Netzwerkfehler)
      // und Backend an, aber Datenbank weg (HTTP 503).
      this.probe.set({ state: 'offline' });
    }
  }
}
