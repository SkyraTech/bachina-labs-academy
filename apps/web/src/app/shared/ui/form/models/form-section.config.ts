import { FormFieldConfig } from './form-field.config';

/**
 * Section grouping for complex dynamic forms.
 */
export interface FormSectionConfig {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly fields: readonly FormFieldConfig[];
  /** Grid columns count for section layout (default 12) */
  readonly columns?: 1 | 2 | 3 | 4 | 6 | 12;
  readonly collapsible?: boolean;
}
