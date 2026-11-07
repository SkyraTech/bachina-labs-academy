import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReaderTableOfContentsComponent } from './reader-table-of-contents.component';
import { TocItem } from '../public-article-reader/public-article-reader.component';

describe('ReaderTableOfContentsComponent', () => {
  let component: ReaderTableOfContentsComponent;
  let fixture: ComponentFixture<ReaderTableOfContentsComponent>;

  const mockTocItems: TocItem[] = [
    { id: 'introduction', text: 'Introduction', level: 1 },
    { id: 'architecture-overview', text: 'Architecture Overview', level: 2 },
    { id: 'sub-details', text: 'Sub Details', level: 3 },
    { id: 'conclusion', text: 'Conclusion', level: 2 },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReaderTableOfContentsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReaderTableOfContentsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('tocItems', mockTocItems);
    fixture.componentRef.setInput('activeId', 'architecture-overview');
    fixture.detectChanges();
  });

  it('renders desktop and mobile navigation links', () => {
    const el: HTMLElement = fixture.nativeElement;
    const desktopLinks = el.querySelectorAll('.toc-desktop-link');
    expect(desktopLinks.length).toBe(4);

    expect(desktopLinks[0].textContent?.trim()).toBe('Introduction');
    expect(desktopLinks[1].textContent?.trim()).toBe('Architecture Overview');
  });

  it('highlights the active section and applies aria-current="location"', () => {
    const el: HTMLElement = fixture.nativeElement;
    const activeLink = el.querySelector('[data-testid="toc-desktop-link-architecture-overview"]');
    expect(activeLink).toBeTruthy();
    expect(activeLink?.classList.contains('active')).toBe(true);
    expect(activeLink?.getAttribute('aria-current')).toBe('location');

    const inactiveLink = el.querySelector('[data-testid="toc-desktop-link-introduction"]');
    expect(inactiveLink?.classList.contains('active')).toBe(false);
    expect(inactiveLink?.getAttribute('aria-current')).toBeNull();
  });

  it('toggles mobile disclosure panel', () => {
    expect(component.mobileOpen()).toBe(false);
    component.toggleMobile();
    expect(component.mobileOpen()).toBe(true);
    fixture.detectChanges();

    const mobileContent = fixture.nativeElement.querySelector('#mobile-toc-nav');
    expect(mobileContent).toBeTruthy();
  });

  it('handles smooth scroll navigation and emits navigateTo on click', () => {
    const emitSpy = vi.spyOn(component.navigateTo, 'emit');
    const mockTarget = document.createElement('div');
    mockTarget.id = 'conclusion';
    mockTarget.scrollIntoView = vi.fn();
    document.body.appendChild(mockTarget);

    const event = new MouseEvent('click', { cancelable: true });
    vi.spyOn(event, 'preventDefault');

    component.scrollToSection(event, 'conclusion');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockTarget.scrollIntoView).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('conclusion');

    document.body.removeChild(mockTarget);
  });

  it('renders level 4 headings with proper indentation class', () => {
    fixture.componentRef.setInput('tocItems', [
      { id: 'h1', text: 'H1 Heading', level: 1 },
      { id: 'h4', text: 'H4 Heading', level: 4 },
    ]);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const desktopLink = el.querySelector('[data-testid="toc-desktop-link-h4"]');
    expect(desktopLink).toBeTruthy();
    expect(desktopLink?.classList.contains('indent-level-4')).toBe(true);
  });

  it('respects mode input for mobile-only and desktop-only rendering', () => {
    fixture.componentRef.setInput('mode', 'mobile');
    fixture.detectChanges();
    let el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="reader-toc-mobile"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="reader-toc-desktop"]')).toBeNull();

    fixture.componentRef.setInput('mode', 'desktop');
    fixture.detectChanges();
    el = fixture.nativeElement;
    expect(el.querySelector('[data-testid="reader-toc-mobile"]')).toBeNull();
    expect(el.querySelector('[data-testid="reader-toc-desktop"]')).toBeTruthy();
  });

  it('respects prefers-reduced-motion: reduce when scrolling', () => {
    const mockTarget = document.createElement('div');
    mockTarget.id = 'conclusion';
    mockTarget.scrollIntoView = vi.fn();
    document.body.appendChild(mockTarget);

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const event = new MouseEvent('click', { cancelable: true });
    component.scrollToSection(event, 'conclusion');

    expect(mockTarget.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });

    document.body.removeChild(mockTarget);
  });
});
