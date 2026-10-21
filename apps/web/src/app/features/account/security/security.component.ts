import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  ActiveSession,
  AuthApiService,
  AuthStateService,
} from '../../../core';
import {
  AcademyDialogService,
  DataTableComponent,
  EmptyStateComponent,
  StatusBadgeComponent,
  TableActionConfig,
  TableColumnConfig,
  ToastService,
} from '../../../shared/ui';

export interface DisplaySession extends ActiveSession, Record<string, unknown> {
  readonly deviceLabel: string;
  readonly formattedCreatedAt: string;
  readonly formattedLastSeenAt: string;
  readonly formattedExpiresAt: string;
  readonly rememberMeLabel: string;
}

@Component({
  selector: 'app-security',
  standalone: true,
  imports: [
    CommonModule,
    DataTableComponent,
    EmptyStateComponent,
    StatusBadgeComponent,
  ],
  templateUrl: './security.component.html',
  styleUrl: './security.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecurityComponent implements OnInit {
  private readonly authApi = inject(AuthApiService);
  private readonly authState = inject(AuthStateService);
  private readonly dialogService = inject(AcademyDialogService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);

  readonly sessions = signal<DisplaySession[]>([]);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);
  readonly revokingSessionId = signal<string | null>(null);
  readonly loggingOutAll = signal<boolean>(false);

  readonly tableColumns: readonly TableColumnConfig<DisplaySession>[] = [
    {
      field: 'deviceLabel',
      header: 'Device & Browser',
      sortable: false,
    },
    {
      field: 'ipAddress',
      header: 'IP Address',
      sortable: false,
    },
    {
      field: 'formattedCreatedAt',
      header: 'Signed In',
      sortable: false,
    },
    {
      field: 'formattedLastSeenAt',
      header: 'Last Active',
      sortable: false,
    },
    {
      field: 'formattedExpiresAt',
      header: 'Expires',
      sortable: false,
    },
    {
      field: 'rememberMeLabel',
      header: 'Session Type',
      sortable: false,
    },
  ];

  readonly tableActions: readonly TableActionConfig<DisplaySession>[] = [
    {
      id: 'revoke-session',
      label: 'Revoke',
      variant: 'danger',
      isDisabled: (row) => this.revokingSessionId() === row.id || this.loggingOutAll(),
      execute: (row) => this.confirmRevokeSession(row),
    },
  ];

  ngOnInit(): void {
    this.loadSessions();
  }

  loadSessions(): void {
    this.loading.set(true);
    this.error.set(null);

    this.authApi.getSessions().subscribe({
      next: (sessions) => {
        this.loading.set(false);
        const mapped = sessions.map((sess) => this.mapDisplaySession(sess));
        // Sort so current session is first
        mapped.sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0));
        this.sessions.set(mapped);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Unable to load active sessions. Please check your network and retry.');
      },
    });
  }

  async confirmRevokeSession(session: DisplaySession): Promise<void> {
    const isCurrent = session.isCurrent;
    const confirmed = await this.dialogService.danger({
      title: isCurrent ? 'Sign out this device?' : 'Revoke device session?',
      message: isCurrent
        ? 'Revoking this active session will sign you out of this browser immediately.'
        : `Are you sure you want to revoke the session on ${session.deviceLabel}? That device will be signed out immediately.`,
      confirmLabel: isCurrent ? 'Sign Out' : 'Revoke Session',
      cancelLabel: 'Keep Session',
    });

    if (!confirmed) {
      return;
    }

    this.revokingSessionId.set(session.id);

    this.authApi.revokeSession(session.id).subscribe({
      next: (response) => {
        this.revokingSessionId.set(null);

        if (response.isCurrentSession || isCurrent) {
          this.toastService.success('You have been signed out.');
          this.authState.setUnauthenticated();
          this.router.navigate(['/login']);
        } else {
          this.toastService.success('Device session has been revoked.');
          this.loadSessions();
        }
      },
      error: (err: unknown) => {
        this.revokingSessionId.set(null);
        const message =
          (err as { error?: { message?: string } })?.error?.message ??
          'Failed to revoke session. It may have already expired.';
        this.toastService.error(message);
        this.loadSessions();
      },
    });
  }

  async onLogoutAll(): Promise<void> {
    const confirmed = await this.dialogService.danger({
      title: 'Sign out of all devices?',
      message:
        'This will immediately revoke all active sessions across every device, including this one. You will need to sign in again to continue.',
      confirmLabel: 'Sign Out All Devices',
      cancelLabel: 'Cancel',
    });

    if (!confirmed) {
      return;
    }

    this.loggingOutAll.set(true);

    this.authState.logoutAll().subscribe({
      next: (res) => {
        this.loggingOutAll.set(false);
        this.toastService.success(res.message || 'All sessions have been revoked.');
        this.router.navigate(['/login']);
      },
      error: () => {
        this.loggingOutAll.set(false);
        this.toastService.error('Unable to sign out all devices. Please retry.');
      },
    });
  }

  parseDeviceUserAgent(ua: string | null): string {
    if (!ua) return 'Unknown Device';

    let browser = 'Web Browser';
    if (ua.includes('Edg/')) browser = 'Microsoft Edge';
    else if (ua.includes('Chrome/')) browser = 'Google Chrome';
    else if (ua.includes('Firefox/')) browser = 'Mozilla Firefox';
    else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Apple Safari';

    let os = 'Unknown OS';
    if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';

    return `${browser} on ${os}`;
  }

  formatDate(dateVal: string | Date | null): string {
    if (!dateVal) return 'Never';
    try {
      const d = typeof dateVal === 'string' ? new Date(dateVal) : dateVal;
      if (isNaN(d.getTime())) return String(dateVal);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return String(dateVal);
    }
  }

  private mapDisplaySession(sess: ActiveSession): DisplaySession {
    return {
      ...sess,
      deviceLabel: this.parseDeviceUserAgent(sess.userAgent),
      formattedCreatedAt: this.formatDate(sess.createdAt),
      formattedLastSeenAt: this.formatDate(sess.lastSeenAt),
      formattedExpiresAt: this.formatDate(sess.expiresAt),
      rememberMeLabel: sess.rememberMe ? '30-Day Session' : '24-Hour Session',
    };
  }
}
