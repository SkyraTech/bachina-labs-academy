import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { SecurityComponent } from './security.component';
import { ActiveSession, AuthApiService, AuthStateService } from '../../../core';
import { AcademyDialogService, ToastService } from '../../../shared/ui';

describe('SecurityComponent', () => {
  let component: SecurityComponent;
  let fixture: ComponentFixture<SecurityComponent>;
  let router: Router;

  let authApiMock: {
    getSessions: ReturnType<typeof vi.fn>;
    revokeSession: ReturnType<typeof vi.fn>;
  };
  let authStateMock: {
    setUnauthenticated: ReturnType<typeof vi.fn>;
    logoutAll: ReturnType<typeof vi.fn>;
  };
  let dialogMock: {
    danger: ReturnType<typeof vi.fn>;
  };
  let toastMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  const mockSessions: ActiveSession[] = [
    {
      id: 'sess-remote',
      createdAt: '2026-10-14T10:00:00Z',
      lastSeenAt: '2026-10-15T08:00:00Z',
      expiresAt: '2026-10-16T10:00:00Z',
      rememberMe: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      ipAddress: '192.168.1.50',
      isCurrent: false,
    },
    {
      id: 'sess-current',
      createdAt: '2026-10-15T09:00:00Z',
      lastSeenAt: '2026-10-15T12:00:00Z',
      expiresAt: '2026-11-14T09:00:00Z',
      rememberMe: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36',
      ipAddress: '127.0.0.1',
      isCurrent: true,
    },
  ];

  beforeEach(async () => {
    authApiMock = {
      getSessions: vi.fn().mockReturnValue(of(mockSessions)),
      revokeSession: vi.fn().mockReturnValue(of({ message: 'Session revoked.', isCurrentSession: false })),
    };
    authStateMock = {
      setUnauthenticated: vi.fn(),
      logoutAll: vi.fn().mockReturnValue(of({ message: 'All sessions revoked.', revokedCount: 2 })),
    };
    dialogMock = {
      danger: vi.fn().mockResolvedValue(true),
    };
    toastMock = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SecurityComponent],
      providers: [
        { provide: AuthApiService, useValue: authApiMock },
        { provide: AuthStateService, useValue: authStateMock },
        { provide: AcademyDialogService, useValue: dialogMock },
        { provide: ToastService, useValue: toastMock },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(SecurityComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should load active sessions on init and place current session first', () => {
    expect(authApiMock.getSessions).toHaveBeenCalledTimes(1);
    expect(component.loading()).toBe(false);
    expect(component.sessions().length).toBe(2);

    // Current session is sorted first
    expect(component.sessions()[0].id).toBe('sess-current');
    expect(component.sessions()[0].isCurrent).toBe(true);
    expect(component.sessions()[0].deviceLabel).toContain('Google Chrome on Windows');
    expect(component.sessions()[0].rememberMeLabel).toBe('30-Day Session');

    expect(component.sessions()[1].id).toBe('sess-remote');
    expect(component.sessions()[1].isCurrent).toBe(false);
    expect(component.sessions()[1].deviceLabel).toContain('Apple Safari on iOS');
    expect(component.sessions()[1].rememberMeLabel).toBe('24-Hour Session');
  });

  it('2. should display error state when sessions fail to load and retry successfully', () => {
    authApiMock.getSessions.mockReturnValueOnce(throwError(() => new Error('Server error')));

    component.loadSessions();
    expect(component.loading()).toBe(false);
    expect(component.error()).toContain('Unable to load active sessions');

    // Test retry
    authApiMock.getSessions.mockReturnValueOnce(of(mockSessions));
    component.loadSessions();
    expect(component.error()).toBeNull();
    expect(component.sessions().length).toBe(2);
  });

  it('3. should revoke another device session after user confirmation', async () => {
    dialogMock.danger.mockResolvedValueOnce(true);
    const remoteSession = component.sessions().find((s) => !s.isCurrent)!;

    await component.confirmRevokeSession(remoteSession);

    expect(dialogMock.danger).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Revoke device session?',
        confirmLabel: 'Revoke Session',
      })
    );
    expect(authApiMock.revokeSession).toHaveBeenCalledWith('sess-remote');
    expect(toastMock.success).toHaveBeenCalledWith('Device session has been revoked.');
  });

  it('4. should not revoke session if user cancels confirmation dialog', async () => {
    dialogMock.danger.mockResolvedValueOnce(false);
    const remoteSession = component.sessions().find((s) => !s.isCurrent)!;

    await component.confirmRevokeSession(remoteSession);

    expect(authApiMock.revokeSession).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('5. should sign out and redirect to /login when current session is revoked', async () => {
    dialogMock.danger.mockResolvedValueOnce(true);
    authApiMock.revokeSession.mockReturnValueOnce(of({ message: 'Session revoked.', isCurrentSession: true }));

    const currentSession = component.sessions().find((s) => s.isCurrent)!;
    await component.confirmRevokeSession(currentSession);

    expect(authApiMock.revokeSession).toHaveBeenCalledWith('sess-current');
    expect(authStateMock.setUnauthenticated).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith('You have been signed out.');
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('6. should logout all devices after user confirmation and navigate to /login', async () => {
    dialogMock.danger.mockResolvedValueOnce(true);

    await component.onLogoutAll();

    expect(dialogMock.danger).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sign out of all devices?',
        confirmLabel: 'Sign Out All Devices',
      })
    );
    expect(authStateMock.logoutAll).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith('All sessions revoked.');
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('7. should not logout all devices if user cancels confirmation dialog', async () => {
    dialogMock.danger.mockResolvedValueOnce(false);

    await component.onLogoutAll();

    expect(authStateMock.logoutAll).not.toHaveBeenCalled();
  });

  it('8. should parse various user-agents gracefully', () => {
    expect(component.parseDeviceUserAgent(null)).toBe('Unknown Device');
    expect(component.parseDeviceUserAgent('')).toBe('Unknown Device');
    expect(component.parseDeviceUserAgent('Mozilla/5.0 Firefox/130.0 Linux')).toBe('Mozilla Firefox on Linux');
    expect(component.parseDeviceUserAgent('Mozilla/5.0 Edg/129.0 Macintosh')).toBe('Microsoft Edge on macOS');
  });
});
