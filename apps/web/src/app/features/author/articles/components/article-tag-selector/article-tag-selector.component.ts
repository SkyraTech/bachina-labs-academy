import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaxonomyApiService } from '../../../../../core/taxonomy/services/taxonomy-api.service';
import { Tag } from '../../../../../core/taxonomy/models/taxonomy.models';

export const MAX_ARTICLE_TAGS = 20;

@Component({
  selector: 'app-article-tag-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './article-tag-selector.component.html',
  styleUrl: './article-tag-selector.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleTagSelectorComponent implements OnInit {
  private readonly taxonomyApi = inject(TaxonomyApiService);

  readonly selectedTagIds = input<string[]>([]);
  readonly disabled = input<boolean>(false);
  readonly tagsChange = output<string[]>();

  readonly allTags = signal<Tag[]>([]);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal<string>('');
  readonly isDropdownOpen = signal<boolean>(false);
  readonly validationMessage = signal<string | null>(null);

  /** Map of tag ID to tag entity for fast label lookup */
  readonly tagMap = computed(() => {
    const map = new Map<string, Tag>();
    for (const t of this.allTags()) {
      map.set(t.id, t);
    }
    return map;
  });

  /** Selected tags as full Tag objects (or synthetic if not yet loaded in catalog) */
  readonly selectedTags = computed(() => {
    const map = this.tagMap();
    return this.selectedTagIds().map((id) => map.get(id) ?? { id, name: id, slug: id, createdAt: '', updatedAt: '' });
  });

  /** Tags that are not currently selected and match search query */
  readonly unselectedFilteredTags = computed(() => {
    const selectedSet = new Set(this.selectedTagIds());
    const query = this.searchQuery().trim().toLowerCase();

    return this.allTags()
      .filter((t) => !selectedSet.has(t.id))
      .filter((t) => !query || t.name.toLowerCase().includes(query) || t.slug.toLowerCase().includes(query));
  });

  ngOnInit(): void {
    this.loadTags();
  }

  loadTags(): void {
    this.loading.set(true);
    this.error.set(null);

    this.taxonomyApi.getTags(1, 100).subscribe({
      next: (res) => {
        this.allTags.set(res.items || []);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load tags.');
        this.loading.set(false);
      },
    });
  }

  addTag(tagId: string): void {
    if (this.disabled()) return;

    const current = this.selectedTagIds();
    if (current.includes(tagId)) {
      return; // strict duplicate prevention
    }

    if (current.length >= MAX_ARTICLE_TAGS) {
      this.validationMessage.set(`Maximum of ${MAX_ARTICLE_TAGS} tags allowed per article.`);
      return;
    }

    this.validationMessage.set(null);
    const next = [...current, tagId];
    this.tagsChange.emit(next);
    this.searchQuery.set('');
    this.isDropdownOpen.set(false);
  }

  removeTag(tagId: string): void {
    if (this.disabled()) return;

    const next = this.selectedTagIds().filter((id) => id !== tagId);
    this.validationMessage.set(null);
    this.tagsChange.emit(next);
  }

  toggleDropdown(): void {
    if (this.disabled()) return;
    this.isDropdownOpen.update((open) => !open);
  }

  closeDropdown(): void {
    this.isDropdownOpen.set(false);
  }
}
