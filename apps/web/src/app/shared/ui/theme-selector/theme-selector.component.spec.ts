import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ThemeSelectorComponent } from './theme-selector.component';
import { ThemeService } from '../../../core/theme/theme.service';

describe('ThemeSelectorComponent', () => {
  let fixture: ComponentFixture<ThemeSelectorComponent>;
  let component: ThemeSelectorComponent;
  let themeService: ThemeService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ThemeSelectorComponent],
      providers: [ThemeService],
    }).compileComponents();

    fixture = TestBed.createComponent(ThemeSelectorComponent);
    component = fixture.componentInstance;
    themeService = TestBed.inject(ThemeService);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render exactly 2 theme options: Light and Dark', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    expect(buttons.length).toBe(2);

    const labels = Array.from(buttons).map((btn: any) => btn.getAttribute('aria-label'));
    expect(labels).toContain('Light mode');
    expect(labels).toContain('Dark mode');
    expect(labels).not.toContain('System mode');
  });

  it('should have radiogroup semantics and accessible labels', () => {
    const group = fixture.nativeElement.querySelector('.theme-pill-track');
    expect(group?.getAttribute('role')).toBe('radiogroup');
    expect(group?.getAttribute('aria-label')).toBe('Theme selection');

    const lightBtn = fixture.nativeElement.querySelector('button[aria-label="Light mode"]');
    const darkBtn = fixture.nativeElement.querySelector('button[aria-label="Dark mode"]');
    expect(lightBtn).not.toBeNull();
    expect(darkBtn).not.toBeNull();
    expect(lightBtn.getAttribute('type')).toBe('button');
    expect(darkBtn.getAttribute('type')).toBe('button');
  });

  it('should visually highlight and mark aria-checked for effective light theme', () => {
    themeService.setTheme('light');
    fixture.detectChanges();

    const lightBtn = fixture.nativeElement.querySelector('button[aria-label="Light mode"]');
    const darkBtn = fixture.nativeElement.querySelector('button[aria-label="Dark mode"]');

    expect(lightBtn.classList.contains('active')).toBe(true);
    expect(lightBtn.getAttribute('aria-checked')).toBe('true');
    expect(darkBtn.classList.contains('active')).toBe(false);
    expect(darkBtn.getAttribute('aria-checked')).toBe('false');
  });

  it('should visually highlight and mark aria-checked for effective dark theme', () => {
    themeService.setTheme('dark');
    fixture.detectChanges();

    const lightBtn = fixture.nativeElement.querySelector('button[aria-label="Light mode"]');
    const darkBtn = fixture.nativeElement.querySelector('button[aria-label="Dark mode"]');

    expect(darkBtn.classList.contains('active')).toBe(true);
    expect(darkBtn.getAttribute('aria-checked')).toBe('true');
    expect(lightBtn.classList.contains('active')).toBe(false);
    expect(lightBtn.getAttribute('aria-checked')).toBe('false');
  });

  it('should call setTheme with "light" when Light button is clicked', () => {
    const lightBtn = fixture.nativeElement.querySelector('button[aria-label="Light mode"]') as HTMLButtonElement;
    lightBtn.click();
    fixture.detectChanges();

    expect(themeService.mode()).toBe('light');
    expect(themeService.resolvedTheme()).toBe('light');
  });

  it('should call setTheme with "dark" when Dark button is clicked', () => {
    const darkBtn = fixture.nativeElement.querySelector('button[aria-label="Dark mode"]') as HTMLButtonElement;
    darkBtn.click();
    fixture.detectChanges();

    expect(themeService.mode()).toBe('dark');
    expect(themeService.resolvedTheme()).toBe('dark');
  });

  it('should reflect resolvedTheme when mode is system without storing forced override', () => {
    // Mode is system by default when storage is clear
    themeService.setTheme('system');
    fixture.detectChanges();

    const resolved = themeService.resolvedTheme();
    const activeBtn = fixture.nativeElement.querySelector(`button[aria-label="${resolved === 'light' ? 'Light' : 'Dark'} mode"]`);
    expect(activeBtn.classList.contains('active')).toBe(true);
    expect(activeBtn.getAttribute('aria-checked')).toBe('true');
  });
});
