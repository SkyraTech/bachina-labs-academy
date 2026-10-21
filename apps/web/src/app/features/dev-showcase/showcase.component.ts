import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AcademyDialogService,
  DataTableComponent,
  DynamicFormComponent,
  EmptyStateComponent,
  FormActionConfig,
  FormFieldConfig,
  LoadingSkeletonComponent,
  StatusBadgeComponent,
  TableActionConfig,
  TableColumnConfig,
  TableQueryModel,
  ThemeSelectorComponent,
  ToastService,
} from '../../shared/ui';
import { FormDialogComponent } from '../../shared/ui/dialog/components/form-dialog/form-dialog.component';

interface ShowcaseArticle extends Record<string, unknown> {
  id: string;
  title: string;
  category: string;
  status: 'published' | 'draft' | 'archived';
  readTime: string;
  publishedDate: string;
}

/**
 * Isolated development-only showcase demonstrating all reusable SaaS UI components.
 * Excluded from production routing.
 */
@Component({
  selector: 'app-showcase',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DynamicFormComponent,
    DataTableComponent,
    EmptyStateComponent,
    LoadingSkeletonComponent,
    StatusBadgeComponent,
    ThemeSelectorComponent,
  ],
  templateUrl: './showcase.component.html',
  styleUrl: './showcase.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShowcaseComponent {
  private readonly dialogService = inject(AcademyDialogService);
  private readonly toastService = inject(ToastService);

  /** Submitted Form Payload display */
  readonly submittedPayload = signal<Record<string, unknown> | null>(null);

  /** Data Table states */
  readonly tableMode = signal<'client' | 'server'>('client');
  readonly tableLoading = signal<boolean>(false);
  readonly tableEmpty = signal<boolean>(false);
  readonly selectedTableRows = signal<readonly ShowcaseArticle[]>([]);
  readonly lastServerQuery = signal<TableQueryModel | null>(null);

  /** Dialog interaction output */
  readonly lastDialogResult = signal<string | null>(null);

  /** Dynamic Form Field Specifications */
  readonly sampleFormFields: FormFieldConfig[] = [
    {
      name: 'authorName',
      label: 'Author Full Name',
      type: 'text',
      placeholder: 'e.g. Jane Architect',
      validation: { required: true, minLength: 3 },
      colSpan: 6,
    },
    {
      name: 'authorEmail',
      label: 'Contact Email',
      type: 'email',
      placeholder: 'jane@skyratech.com',
      validation: { required: true },
      colSpan: 6,
    },
    {
      name: 'experienceLevel',
      label: 'Engineering Role',
      type: 'select',
      placeholder: 'Select engineering role...',
      options: [
        { label: 'Principal Architect', value: 'architect' },
        { label: 'Staff Platform Engineer', value: 'staff' },
        { label: 'Senior Backend Developer', value: 'senior' },
        { label: 'Technical Writer', value: 'writer' },
      ],
      validation: { required: true },
      colSpan: 6,
    },
    {
      name: 'specialization',
      label: 'Specializations (Multiselect)',
      type: 'multiselect',
      options: [
        { label: 'Angular 22 Signals', value: 'signals' },
        { label: 'PostgreSQL 17 & Outbox', value: 'postgres' },
        { label: 'NestJS Clean Architecture', value: 'nestjs' },
        { label: 'Tailwind CSS 4', value: 'tailwind' },
        { label: 'DevOps & CI/CD', value: 'devops' },
      ],
      colSpan: 6,
    },
    {
      name: 'architectPortfolio',
      label: 'Architect Portfolio / Systems URL',
      type: 'text',
      placeholder: 'https://github.com/my-architecture',
      visibleWhen: (val) => val['experienceLevel'] === 'architect' || val['experienceLevel'] === 'staff',
      hint: 'Visible only for Architect or Staff engineering roles',
      colSpan: 12,
    },
    {
      name: 'bio',
      label: 'Technical Biography',
      type: 'textarea',
      placeholder: 'Describe your distributed systems experience...',
      validation: { maxLength: 300 },
      colSpan: 12,
    },
    {
      name: 'enableNotifications',
      label: 'Enable Instant Publication Notifications',
      type: 'toggle',
      defaultValue: true,
      colSpan: 6,
    },
    {
      name: 'agreedToTerms',
      label: 'I acknowledge the editorial peer review guidelines',
      type: 'checkbox',
      validation: { required: true },
      colSpan: 6,
    },
  ];

  readonly sampleFormActions: FormActionConfig[] = [
    { id: 'reset', label: 'Reset Fields', type: 'reset', variant: 'ghost' },
    { id: 'submit', label: 'Validate & Submit Form', type: 'submit', variant: 'brand' },
  ];

  /** Data Table Sample Data */
  readonly sampleArticles: ShowcaseArticle[] = [
    {
      id: 'art-1',
      title: 'Architecting Resilient Distributed Event Streams with PostgreSQL & NestJS',
      category: 'Architecture',
      status: 'published',
      readTime: '8 min',
      publishedDate: '2026-10-10',
    },
    {
      id: 'art-2',
      title: 'Zoneless Angular 22: Building Enterprise SaaS Without Zone.js',
      category: 'Frontend',
      status: 'published',
      readTime: '6 min',
      publishedDate: '2026-10-12',
    },
    {
      id: 'art-3',
      title: 'Advisory Locks and Transactional Outbox Patterns in PostgreSQL 17',
      category: 'Database',
      status: 'published',
      readTime: '11 min',
      publishedDate: '2026-10-14',
    },
    {
      id: 'art-4',
      title: 'Tailwind CSS 4 Native Engine Integration Guide for Modern Angular',
      category: 'Styling',
      status: 'draft',
      readTime: '5 min',
      publishedDate: '2026-10-15',
    },
    {
      id: 'art-5',
      title: 'Prisma 6 Type-Safe Migrations in Multi-Tenant Environments',
      category: 'Database',
      status: 'archived',
      readTime: '9 min',
      publishedDate: '2026-09-28',
    },
    {
      id: 'art-6',
      title: 'Decoupled Observability: OpenTelemetry Traces with Zero Overhead',
      category: 'DevOps',
      status: 'draft',
      readTime: '7 min',
      publishedDate: '2026-10-02',
    },
  ];

  /** Data Table Column Definitions */
  readonly sampleTableColumns: TableColumnConfig<ShowcaseArticle>[] = [
    { field: 'title', header: 'Article Title', sortable: true, width: '40%' },
    { field: 'category', header: 'Category', sortable: true, width: '15%' },
    { field: 'status', header: 'Status', sortable: true, width: '15%' },
    { field: 'readTime', header: 'Reading Time', sortable: false, width: '15%' },
    { field: 'publishedDate', header: 'Date', sortable: true, width: '15%' },
  ];

  /** Data Table Action Buttons */
  readonly sampleTableActions: TableActionConfig<ShowcaseArticle>[] = [
    {
      id: 'view',
      label: 'Preview',
      variant: 'secondary',
      execute: (row) => {
        this.toastService.info(`Previewing article: ${row.title}`);
      },
    },
    {
      id: 'edit',
      label: 'Edit',
      variant: 'brand',
      execute: (row) => {
        this.openEditDialog(row);
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      variant: 'danger',
      execute: async (row) => {
        const confirmed = await this.dialogService.danger({
          title: 'Delete Article',
          message: `Are you sure you want to permanently delete "${row.title}"? This action cannot be reversed.`,
          confirmLabel: 'Delete Draft',
        });
        if (confirmed) {
          this.toastService.success(`Draft "${row.title}" deleted.`);
        }
      },
    },
  ];

  /** Form Handlers */
  onFormSubmit(values: Record<string, unknown>): void {
    this.submittedPayload.set(values);
    this.toastService.success('Dynamic form validated and submitted successfully!');
  }

  onFormReset(): void {
    this.submittedPayload.set(null);
    this.toastService.info('Form inputs have been reset.');
  }

  /** Table Handlers */
  onTableQueryChange(query: TableQueryModel): void {
    this.lastServerQuery.set(query);
    this.toastService.info(`Server query emitted: Page ${query.page}, Search: "${query.search ?? ''}"`);
  }

  onTableSelectionChange(selected: readonly ShowcaseArticle[]): void {
    this.selectedTableRows.set(selected);
  }

  toggleTableLoading(): void {
    this.tableLoading.update((v) => !v);
  }

  toggleTableEmpty(): void {
    this.tableEmpty.update((v) => !v);
  }

  toggleTableMode(): void {
    this.tableMode.update((m) => (m === 'client' ? 'server' : 'client'));
    this.toastService.info(`Table mode switched to: ${this.tableMode().toUpperCase()}`);
  }

  /** Dialog Triggers */
  async triggerConfirmDialog(): Promise<void> {
    const result = await this.dialogService.confirm({
      title: 'Publish Article to Academy',
      message: 'Are you ready to publish this technical guide to all registered engineers?',
      confirmLabel: 'Publish Now',
      cancelLabel: 'Keep as Draft',
    });
    this.lastDialogResult.set(result ? 'User confirmed publication.' : 'User cancelled publication.');
    if (result) {
      this.toastService.success('Article published to Academy feed.');
    }
  }

  async triggerDangerDialog(): Promise<void> {
    const result = await this.dialogService.danger({
      title: 'Revoke Author Access',
      message: 'Permanently revoke editorial privileges for this workspace contributor? All drafts will be unassigned.',
      confirmLabel: 'Revoke Privileges',
    });
    this.lastDialogResult.set(result ? 'User confirmed destructive revocation.' : 'User cancelled destructive action.');
    if (result) {
      this.toastService.error('Author access was permanently revoked.');
    }
  }

  openEditDialog(article: ShowcaseArticle): void {
    const dialogRef = this.dialogService.open(FormDialogComponent, {
      data: {
        title: 'Quick Edit Article Metadata',
        description: `Updating parameters for "${article.title}"`,
        fields: [
          {
            name: 'title',
            label: 'Article Title',
            type: 'text',
            defaultValue: article.title,
            validation: { required: true },
          },
          {
            name: 'category',
            label: 'Category',
            type: 'select',
            defaultValue: article.category,
            options: [
              { label: 'Architecture', value: 'Architecture' },
              { label: 'Frontend', value: 'Frontend' },
              { label: 'Database', value: 'Database' },
              { label: 'DevOps', value: 'DevOps' },
            ],
          },
        ],
      },
    });

    dialogRef.closed.subscribe((result) => {
      if (result && typeof result === 'object' && 'confirmed' in result && result.confirmed) {
        this.toastService.success('Article metadata updated successfully!');
      }
    });
  }

  /** Toast Triggers */
  triggerToast(type: 'success' | 'error' | 'warning' | 'info'): void {
    switch (type) {
      case 'success':
        this.toastService.success('Configuration saved without errors.', 'Success');
        break;
      case 'error':
        this.toastService.error('Connection timed out while fetching schema.', 'Database Error');
        break;
      case 'warning':
        this.toastService.warning('Unsaved changes will be discarded upon navigating away.', 'Warning');
        break;
      case 'info':
        this.toastService.info('New platform components available in this workspace.', 'Platform Notice');
        break;
    }
  }

  triggerDuplicateToast(): void {
    this.toastService.info('This identical notification is duplicate-suppressed within 2s.');
  }
}
