import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PublicLayoutComponent } from './public-layout.component';

describe('PublicLayoutComponent', () => {
  let fixture: ComponentFixture<PublicLayoutComponent>;
  let component: PublicLayoutComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicLayoutComponent],
      providers: [provideRouter([])],
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
});
