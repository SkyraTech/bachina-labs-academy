import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;
  let matchMediaListeners: (() => void)[] = [];
  let matchesDark = true;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    matchMediaListeners = [];
    matchesDark = true;

    // Mock matchMedia in JSDOM
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        get matches() {
          return query.includes('dark') ? matchesDark : !matchesDark;
        },
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event: string, callback: () => void) => {
          if (event === 'change') {
            matchMediaListeners.push(callback);
          }
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: () => false,
      }),
    });

    TestBed.configureTestingModule({
      providers: [ThemeService],
    });
    service = TestBed.inject(ThemeService);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('should be created and default to system mode on first visit when storage is empty', () => {
    expect(service).toBeTruthy();
    expect(service.mode()).toBe('system');
    expect(service.resolvedTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('bla-theme')).toBeNull();
  });

  it('should switch theme to dark and update DOM attribute', () => {
    service.setTheme('dark');
    expect(service.mode()).toBe('dark');
    expect(service.resolvedTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('bla-theme')).toBe('dark');
  });

  it('should switch theme to light and update DOM attribute', () => {
    service.setTheme('light');
    expect(service.mode()).toBe('light');
    expect(service.resolvedTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('bla-theme')).toBe('light');
  });

  it('should switch back to system mode and preserve compatibility', () => {
    service.setTheme('system');
    expect(service.mode()).toBe('system');
    expect(['light', 'dark']).toContain(service.resolvedTheme());
    expect(localStorage.getItem('bla-theme')).toBe('system');
  });

  it('should dynamically update resolvedTheme when OS preference changes and mode is system', () => {
    expect(service.mode()).toBe('system');
    expect(service.resolvedTheme()).toBe('dark');

    // Simulate OS switching to light
    matchesDark = false;
    matchMediaListeners.forEach((fn) => fn());

    expect(service.resolvedTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('should NOT update theme when OS preference changes if user selected manual preference', () => {
    service.setTheme('dark');
    expect(service.mode()).toBe('dark');

    // Simulate OS switching to light
    matchesDark = false;
    matchMediaListeners.forEach((fn) => fn());

    // Should remain dark because user made an explicit manual choice
    expect(service.mode()).toBe('dark');
    expect(service.resolvedTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('should restore stored preference on reload / new instance', () => {
    localStorage.setItem('bla-theme', 'light');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const newService = TestBed.inject(ThemeService);

    expect(newService.mode()).toBe('light');
    expect(newService.resolvedTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('should preserve existing saved "system" preference without forcing overwrite', () => {
    localStorage.setItem('bla-theme', 'system');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const newService = TestBed.inject(ThemeService);

    expect(newService.mode()).toBe('system');
    expect(localStorage.getItem('bla-theme')).toBe('system');
  });
});
