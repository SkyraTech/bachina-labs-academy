import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArticleTagSelectorComponent } from './article-tag-selector.component';
import { TaxonomyApiService } from '../../../../../core/taxonomy/services/taxonomy-api.service';
import { PaginatedTags } from '../../../../../core/taxonomy/models/taxonomy.models';

describe('ArticleTagSelectorComponent', () => {
  let component: ArticleTagSelectorComponent;
  let fixture: ComponentFixture<ArticleTagSelectorComponent>;
  let apiSpy: { getTags: ReturnType<typeof vi.fn> };

  const mockTags: PaginatedTags = {
    items: [
      { id: 'tag-1', name: 'Angular', slug: 'angular', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'tag-2', name: 'PostgreSQL', slug: 'postgresql', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'tag-3', name: 'NestJS', slug: 'nestjs', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
    ],
    total: 3,
    page: 1,
    limit: 100,
    totalPages: 1,
  };

  beforeEach(async () => {
    apiSpy = {
      getTags: vi.fn().mockReturnValue(of(mockTags)),
    };

    await TestBed.configureTestingModule({
      imports: [ArticleTagSelectorComponent],
      providers: [{ provide: TaxonomyApiService, useValue: apiSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleTagSelectorComponent);
    component = fixture.componentInstance;
  });

  it('1. should load tags on init', () => {
    fixture.detectChanges();
    expect(apiSpy.getTags).toHaveBeenCalledWith(1, 100);
    expect(component.allTags().length).toBe(3);
  });

  it('2. should display selected tag chips', () => {
    fixture.componentRef.setInput('selectedTagIds', ['tag-1', 'tag-2']);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const chips = compiled.querySelectorAll('[data-testid="tag-chip"]');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain('Angular');
    expect(chips[1].textContent).toContain('PostgreSQL');
  });

  it('3. should emit tagsChange when tag is added from unselected list', () => {
    fixture.componentRef.setInput('selectedTagIds', ['tag-1']);
    fixture.detectChanges();

    const emitSpy = vi.fn();
    component.tagsChange.subscribe(emitSpy);

    component.addTag('tag-2');
    expect(emitSpy).toHaveBeenCalledWith(['tag-1', 'tag-2']);
  });

  it('4. should emit tagsChange when tag is removed', () => {
    fixture.componentRef.setInput('selectedTagIds', ['tag-1', 'tag-2']);
    fixture.detectChanges();

    const emitSpy = vi.fn();
    component.tagsChange.subscribe(emitSpy);

    component.removeTag('tag-1');
    expect(emitSpy).toHaveBeenCalledWith(['tag-2']);
  });

  it('5. should filter unselected tags based on search query', () => {
    fixture.componentRef.setInput('selectedTagIds', ['tag-1']);
    fixture.detectChanges();

    component.searchQuery.set('nest');
    fixture.detectChanges();

    const filtered = component.unselectedFilteredTags();
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('tag-3');
  });

  it('6. should prevent duplicate tags from being added', () => {
    fixture.componentRef.setInput('selectedTagIds', ['tag-1']);
    fixture.detectChanges();

    const emitSpy = vi.fn();
    component.tagsChange.subscribe(emitSpy);

    component.addTag('tag-1');
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('7. should enforce maximum tag limit of 20 with validation message', () => {
    const twentyTags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    fixture.componentRef.setInput('selectedTagIds', twentyTags);
    fixture.detectChanges();

    const emitSpy = vi.fn();
    component.tagsChange.subscribe(emitSpy);

    component.addTag('another-tag');
    expect(emitSpy).not.toHaveBeenCalled();
    expect(component.validationMessage()).toContain('Maximum of 20 tags allowed');
  });

  it('8. should display error state and allow retry', () => {
    apiSpy.getTags.mockReturnValue(throwError(() => new Error('Tag fetch failed')));
    fixture.detectChanges();

    expect(component.error()).toBe('Failed to load tags.');

    apiSpy.getTags.mockReturnValue(of(mockTags));
    component.loadTags();
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(component.allTags().length).toBe(3);
  });

  it('9. should preserve selected tag IDs even when catalog fails to load or tag is unknown', () => {
    fixture.componentRef.setInput('selectedTagIds', ['unknown-tag-id']);
    apiSpy.getTags.mockReturnValue(throwError(() => new Error('Offline')));
    fixture.detectChanges();

    expect(component.selectedTags().length).toBe(1);
    expect(component.selectedTags()[0].id).toBe('unknown-tag-id');
    expect(component.selectedTags()[0].name).toBe('unknown-tag-id');
  });
});
