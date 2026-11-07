import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaxonomyApiService } from '../../../../../core/taxonomy/services/taxonomy-api.service';
import { Category } from '../../../../../core/taxonomy/models/taxonomy.models';

@Component({
  selector: 'app-article-category-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './article-category-selector.component.html',
  styleUrl: './article-category-selector.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleCategorySelectorComponent implements OnInit {
  private readonly taxonomyApi = inject(TaxonomyApiService);

  readonly selectedCategoryId = input<string | null>(null);
  readonly disabled = input<boolean>(false);
  readonly categoryChange = output<string | null>();

  readonly categories = signal<Category[]>([]);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadCategories();
  }

  loadCategories(): void {
    this.loading.set(true);
    this.error.set(null);

    this.taxonomyApi.getCategories(1, 100).subscribe({
      next: (res) => {
        this.categories.set(res.items || []);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load categories.');
        this.loading.set(false);
      },
    });
  }

  onSelectChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    const nextId = val && val !== 'null' ? val : null;
    this.categoryChange.emit(nextId);
  }

  onSelectModelChange(val: string): void {
    const nextId = val && val !== 'null' ? val : null;
    this.categoryChange.emit(nextId);
  }

  clearCategory(): void {
    if (this.disabled()) return;
    this.categoryChange.emit(null);
  }
}
