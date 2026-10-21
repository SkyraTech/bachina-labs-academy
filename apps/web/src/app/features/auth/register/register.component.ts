import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  DynamicFormComponent,
  FormActionConfig,
  FormFieldConfig,
  ToastService,
} from '../../../shared/ui';
import { AuthApiService, RegisterRequest } from '../../../core';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, RouterLink, DynamicFormComponent],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterComponent {
  private readonly authApi = inject(AuthApiService);
  private readonly toastService = inject(ToastService);

  readonly submitting = signal<boolean>(false);
  readonly serverError = signal<string | null>(null);
  readonly registrationSuccess = signal<{ email: string } | null>(null);

  readonly fields: readonly FormFieldConfig[] = [
    {
      name: 'email',
      label: 'Email address',
      type: 'email',
      placeholder: 'author@skyra-tech.com',
      autocomplete: 'email',
      validation: {
        required: true,
        maxLength: 254,
      },
      hint: 'Your primary engineering email address.',
    },
    {
      name: 'password',
      label: 'Password',
      type: 'password',
      placeholder: 'Minimum 12 characters',
      autocomplete: 'new-password',
      validation: {
        required: true,
        minLength: 12,
        maxLength: 128,
      },
      hint: '12 to 128 characters. Passphrases and spaces accepted.',
    },
  ];

  readonly actions: readonly FormActionConfig[] = [
    {
      id: 'submit-register',
      label: 'Create Account',
      type: 'submit',
      variant: 'brand',
    },
  ];

  onSubmit(formValues: Record<string, unknown>): void {
    if (this.submitting()) return;

    const email = typeof formValues['email'] === 'string' ? formValues['email'].trim() : '';
    const password = typeof formValues['password'] === 'string' ? formValues['password'] : '';

    if (!email || !password) {
      this.serverError.set('Please fill out all required fields.');
      return;
    }

    const payload: RegisterRequest = { email, password };

    this.submitting.set(true);
    this.serverError.set(null);

    this.authApi.register(payload).subscribe({
      next: () => {
        this.submitting.set(false);
        this.registrationSuccess.set({ email });
        this.toastService.success('Registration successful! Please verify your email.');
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        if (err instanceof HttpErrorResponse) {
          if (err.status === 409) {
            this.serverError.set('An account with this email address already exists. Please sign in instead.');
            return;
          }
          if (err.status === 429) {
            this.serverError.set('Too many registration attempts. Please wait before retrying.');
            return;
          }
          if (err.status === 400) {
            const msg = Array.isArray(err.error?.message)
              ? err.error.message.join(', ')
              : err.error?.message;
            this.serverError.set(msg ?? 'Registration validation failed. Please check your inputs.');
            return;
          }
        }
        this.serverError.set('Unable to complete registration. Please check your connection and try again.');
      },
    });
  }
}
