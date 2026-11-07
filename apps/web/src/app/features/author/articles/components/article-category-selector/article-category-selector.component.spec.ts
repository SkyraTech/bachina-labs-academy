import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArticleCategorySelectorComponent } from './article-category-selector.component';
import { TaxonomyApiService } from '../../../../../core/taxonomy/services/taxonomy-api.service';
import { PaginatedCategories } from '../../../../../core/taxonomy/models/taxonomy.models';

describe('ArticleCategorySelectorComponent', () => {
  let component: ArticleCategorySelectorComponent;
  let fixture: ComponentFixture<ArticleCategorySelectorComponent>;
  let apiSpy: { getCategories: ReturnType<typeof vi.fn> };

  const mockCategories: PaginatedCategories = {
    items: [
      {
        id: 'cat-uuid-1',
        name: 'Backend Architecture',
        slug: 'backend-architecture',
        description: 'Backend engineering',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'cat-uuid-2',
        name: 'Frontend Frameworks',
        slug: 'frontend-frameworks',
        description: 'Web UI engineering',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    total: 2,
    page: 1,
    limit: 100,
    totalPages: 1,
  };

  beforeEach(async () => {
    apiSpy = {
      getCategories: vi.fn().mockReturnValue(of(mockCategories)),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleCategorySelectorComponent],
      providers: [{ provide: TaxonomyApiService, useValue: apiSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleCategorySelectorComponent);
    component = fixture.componentInstance;
  });

  it('1. should load categories on init and render select options', () => {
    fixture.detectChanges();

    expect(apiSpy.getCategories).toHaveBeenCalledWith(1, 100);
    expect(component.categories().length).toBe(2);

    const compiled = fixture.nativeElement as HTMLElement;
    const select = compiled.querySelector<HTMLSelectElement>('[data-testid="category-select"]');
    expect(select).not.toBeNull();
    expect(select?.options.length).toBe(3); // 1 default + 2 categories
    expect(select?.options[1].text).toBe('Backend Architecture');
    expect(select?.options[1].value).toBe('cat-uuid-1');
  });

  it('2. should display empty catalog text when no categories exist', () => {
    apiSpy.getCategories.mockReturnValue(of({ items: [], total: 0, page: 1, limit: 100, totalPages: 0 }));
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const emptyNotice = compiled.querySelector('[data-testid="category-empty"]');
    expect(emptyNotice).not.toBeNull();
    expect(emptyNotice?.textContent).toContain('No categories are available yet');
  });

  it('3. should emit categoryChange with category UUID when selection changes', () => {
    fixture.detectChanges();

    const emitSpy = vi.fn();
    component.categoryChange.subscribe(emitSpy);

    const compiled = fixture.nativeElement as HTMLElement;
    const select = compiled.querySelector<HTMLSelectElement>('[data-testid="category-select"]')!;
    select.value = 'cat-uuid-2';
    select.dispatchEvent(new Event('change'));

    expect(emitSpy).toHaveBeenCalledWith('cat-uuid-2');
  });

  it('4. should emit null when category is set to None or cleared', () => {
    fixture.componentRef.setInput('selectedCategoryId', 'cat-uuid-1');
    fixture.detectChanges();

    const emitSpy = vi.fn();
    component.categoryChange.subscribe(emitSpy);

    const compiled = fixture.nativeElement as HTMLElement;
    const clearBtn = compiled.querySelector<HTMLButtonElement>('[data-testid="clear-category-btn"]')!;
    expect(clearBtn).not.toBeNull();
    clearBtn.click();

    expect(emitSpy).toHaveBeenCalledWith(null);
  });

  it('5. should display error banner and allow retry on API failure', () => {
    apiSpy.getCategories.mockReturnValue(throwError(() => new Error('Network error')));
    fixture.detectChanges();

    expect(component.error()).toBe('Failed to load categories.');
    const compiled = fixture.nativeElement as HTMLElement;
    const errorBanner = compiled.querySelector('[data-testid="category-error"]');
    expect(errorBanner).not.toBeNull();

    // Now mock success on retry
    apiSpy.getCategories.mockReturnValue(of(mockCategories));
    const retryBtn = compiled.querySelector<HTMLButtonElement>('[data-testid="category-retry-btn"]')!;
    retryBtn.click();
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(component.categories().length).toBe(2);
  });

  it('6. should emit actual JavaScript null when the unassigned dropdown option is selected', () => {
    fixture.detectChanges();
    const emitSpy = vi.fn();
    component.categoryChange.subscribe(emitSpy);

    component.onSelectModelChange('null');
    expect(emitSpy).toHaveBeenCalledWith(null);

    component.onSelectModelChange('cat-uuid-1');
    expect(emitSpy).toHaveBeenCalledWith('cat-uuid-1');

    component.onSelectModelChange('');
    expect(emitSpy).toHaveBeenCalledWith(null);
  });
});
