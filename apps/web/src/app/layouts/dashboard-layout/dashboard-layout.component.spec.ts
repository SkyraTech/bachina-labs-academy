import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardLayoutComponent } from './dashboard-layout.component';

describe('DashboardLayoutComponent', () => {
  let fixture: ComponentFixture<DashboardLayoutComponent>;
  let component: DashboardLayoutComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardLayoutComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create dashboard layout', () => {
    expect(component).toBeTruthy();
  });

  it('should render desktop sidebar with workspace navigation', () => {
    const sidebar = fixture.nativeElement.querySelector('aside');
    expect(sidebar).toBeTruthy();
    const nav = sidebar.querySelector('nav[aria-label="Sidebar Navigation"]');
    expect(nav).toBeTruthy();
  });

  it('should render workspace header with theme selector', () => {
    const header = fixture.nativeElement.querySelector('header');
    expect(header).toBeTruthy();
    const themeSelector = header.querySelector('app-theme-selector');
    expect(themeSelector).toBeTruthy();
  });
});
