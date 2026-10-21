import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { DashboardLayoutComponent } from './dashboard-layout.component';
import { AuthStateService, CurrentUser } from '../../core';
import { ToastService } from '../../shared/ui';

describe('DashboardLayoutComponent', () => {
  let fixture: ComponentFixture<DashboardLayoutComponent>;
  let component: DashboardLayoutComponent;
  let router: Router;

  const mockUserSignal = signal<CurrentUser | null>({
    id: 'user-1',
    email: 'author@skyra-tech.com',
    role: 'AUTHOR',
    status: 'ACTIVE',
    emailVerifiedAt: '2026-10-15T00:00:00Z',
  });

  let authStateMock: {
    currentUser: typeof mockUserSignal;
    logout: ReturnType<typeof vi.fn>;
  };
  let toastMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authStateMock = {
      currentUser: mockUserSignal,
      logout: vi.fn().mockReturnValue(of({ message: 'Logged out.' })),
    };
    toastMock = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardLayoutComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStateService, useValue: authStateMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(DashboardLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create dashboard layout with author sidebar navigation', () => {
    expect(component).toBeTruthy();
    expect(component.userEmail()).toBe('author@skyra-tech.com');
    expect(component.userInitial()).toBe('A');
    expect(component.userRole()).toBe('AUTHOR');

    const labels = component['sidebarItems']().map((i) => i.label);
    expect(labels).toContain('Overview');
    expect(labels).toContain('Articles');
    expect(labels).toContain('Account Security');
    expect(labels).not.toContain('Admin Hub');
  });

  it('should render admin sidebar navigation when user is ADMIN', () => {
    mockUserSignal.set({
      id: 'admin-1',
      email: 'admin@skyra-tech.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: '2026-10-15T00:00:00Z',
    });
    fixture.detectChanges();

    const labels = component['sidebarItems']().map((i) => i.label);
    expect(labels).toContain('Admin Hub');
    expect(labels).toContain('Account Security');
    expect(labels).not.toContain('Overview');
  });

  it('should sign out user and navigate to /login when sign out is clicked', () => {
    const signOutBtn = fixture.nativeElement.querySelector('#topbar-sign-out');
    expect(signOutBtn).toBeTruthy();

    signOutBtn.click();
    fixture.detectChanges();

    expect(authStateMock.logout).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith('You have been signed out.');
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});
