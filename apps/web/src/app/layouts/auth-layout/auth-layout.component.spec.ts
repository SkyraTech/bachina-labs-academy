import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthLayoutComponent } from './auth-layout.component';

describe('AuthLayoutComponent', () => {
  let fixture: ComponentFixture<AuthLayoutComponent>;
  let component: AuthLayoutComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthLayoutComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create auth layout', () => {
    expect(component).toBeTruthy();
  });

  it('should render brand logo linking back to home', () => {
    const brandLink = fixture.nativeElement.querySelector('a[aria-label="Back to Academy Home"]');
    expect(brandLink).toBeTruthy();
    expect(brandLink.getAttribute('href')).toBe('/');
  });

  it('should render theme selector', () => {
    const themeSelector = fixture.nativeElement.querySelector('app-theme-selector');
    expect(themeSelector).toBeTruthy();
  });

  it('should contain a router outlet inside centered container', () => {
    const outlet = fixture.nativeElement.querySelector('router-outlet');
    expect(outlet).toBeTruthy();
  });
});
