import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    // Mock matchMedia in JSDOM
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('dark'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
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

  it('should be created and default to system or stored mode', () => {
    expect(service).toBeTruthy();
    expect(['light', 'dark', 'system']).toContain(service.mode());
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

  it('should switch back to system mode', () => {
    service.setTheme('system');
    expect(service.mode()).toBe('system');
    expect(['light', 'dark']).toContain(service.resolvedTheme());
    expect(localStorage.getItem('bla-theme')).toBe('system');
  });
});
