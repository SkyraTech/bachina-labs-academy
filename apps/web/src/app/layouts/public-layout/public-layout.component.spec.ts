import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { PublicLayoutComponent } from './public-layout.component';
import { AuthStateService } from '../../core/auth/services/auth-state.service';
import { CurrentUser } from '../../core/auth/models';

describe('PublicLayoutComponent', () => {
  let fixture: ComponentFixture<PublicLayoutComponent>;
  let component: PublicLayoutComponent;

  const mockUserSignal = signal<CurrentUser | null>(null);
  const mockIsAuthenticated = signal<boolean>(false);

  const authStateMock = {
    currentUser: mockUserSignal,
    isAuthenticated: mockIsAuthenticated,
  };

  beforeEach(async () => {
    mockUserSignal.set(null);
    mockIsAuthenticated.set(false);

    await TestBed.configureTestingModule({
      imports: [PublicLayoutComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStateService, useValue: authStateMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create public layout', () => {
    expect(component).toBeTruthy();
  });

  it('should render brand logo link', () => {
    const brandLink = fixture.nativeElement.querySelector('a[aria-label="Bachina Labs Academy Home"]');
    expect(brandLink).toBeTruthy();
    expect(brandLink.textContent).toContain('Bachina Labs');
    expect(brandLink.textContent).toContain('Academy');
  });

  it('should render theme selector in header', () => {
    const themeSelector = fixture.nativeElement.querySelector('app-theme-selector');
    expect(themeSelector).toBeTruthy();
  });

  it('should toggle mobile menu when hamburger button is clicked', () => {
    const toggleButton = fixture.nativeElement.querySelector('button[aria-label="Toggle navigation menu"]');
    expect(toggleButton).toBeTruthy();
    toggleButton.click();
    fixture.detectChanges();
    const mobileNav = fixture.nativeElement.querySelector('nav[aria-label="Mobile Navigation"]');
    expect(mobileNav).toBeTruthy();
  });

  it('should keep desktop nav at lg breakpoint and tablet/mobile drawer toggle at lg:hidden', () => {
    const desktopNav = fixture.nativeElement.querySelector('nav[aria-label="Main Navigation"]') as HTMLElement;
    const toggleButton = fixture.nativeElement.querySelector('button[aria-label="Toggle navigation menu"]') as HTMLElement;
    expect(desktopNav.classList.contains('lg:flex')).toBe(true);
    expect(desktopNav.classList.contains('md:flex')).toBe(false);
    expect(toggleButton.classList.contains('lg:hidden')).toBe(true);
  });

  it('should render Sign in and Get started links when visitor is anonymous', () => {
    const signinLink = fixture.nativeElement.querySelector('a.header-signin');
    const getStartedLink = fixture.nativeElement.querySelector('a.header-btn');
    expect(signinLink).toBeTruthy();
    expect(signinLink.textContent).toContain('Sign in');
    expect(getStartedLink).toBeTruthy();
    expect(getStartedLink.textContent).toContain('Get started');
  });

  it('should render Author Studio navigation link when user is authenticated as AUTHOR without redirect', () => {
    mockIsAuthenticated.set(true);
    mockUserSignal.set({
      id: 'author-1',
      email: 'author@skyra-tech.com',
      role: 'AUTHOR',
      status: 'ACTIVE',
      emailVerifiedAt: '2026-10-15T00:00:00Z',
    });
    fixture.detectChanges();

    const signinLink = fixture.nativeElement.querySelector('a.header-signin');
    expect(signinLink).toBeNull();

    const workspaceBtn = fixture.nativeElement.querySelector('a.header-btn');
    expect(workspaceBtn).toBeTruthy();
    expect(workspaceBtn.textContent).toContain('Author Studio');
    expect(workspaceBtn.getAttribute('href')).toBe('/author');
  });

  it('should render Admin Console navigation link when user is authenticated as ADMIN without redirect', () => {
    mockIsAuthenticated.set(true);
    mockUserSignal.set({
      id: 'admin-1',
      email: 'admin@skyra-tech.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: '2026-10-15T00:00:00Z',
    });
    fixture.detectChanges();

    const workspaceBtn = fixture.nativeElement.querySelector('a.header-btn');
    expect(workspaceBtn).toBeTruthy();
    expect(workspaceBtn.textContent).toContain('Admin Console');
    expect(workspaceBtn.getAttribute('href')).toBe('/admin');
  });

  it('should render My Account navigation link when user is authenticated as READER without redirect', () => {
    mockIsAuthenticated.set(true);
    mockUserSignal.set({
      id: 'reader-1',
      email: 'reader@skyra-tech.com',
      role: 'READER',
      status: 'ACTIVE',
      emailVerifiedAt: '2026-10-15T00:00:00Z',
    });
    fixture.detectChanges();

    const workspaceBtn = fixture.nativeElement.querySelector('a.header-btn');
    expect(workspaceBtn).toBeTruthy();
    expect(workspaceBtn.textContent).toContain('My Account');
    expect(workspaceBtn.getAttribute('href')).toBe('/account/security');
  });
});
