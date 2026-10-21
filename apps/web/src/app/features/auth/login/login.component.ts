import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  DynamicFormComponent,
  FormActionConfig,
  FormFieldConfig,
  ToastService,
} from '../../../shared/ui';
import { AuthApiService, AuthStateService, LoginRequest, UserRole } from '../../../core';

/**
 * Validates and sanitizes a return URL to prevent open-redirect attacks.
 * Directs ADMIN to /admin and AUTHOR to /author by default.
 */
export function sanitizeRedirectUrl(
  url: string | null | undefined,
  role: UserRole = 'AUTHOR'
): string {
  const defaultDestination = role === 'ADMIN' ? '/admin' : '/author';
  if (!url || typeof url !== 'string') {
    return defaultDestination;
  }

  const trimmed = url.trim();

  // Must begin with single forward slash, not '//' or 'http:' or 'javascript:'
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\') || trimmed.includes('://')) {
    return defaultDestination;
  }

  // Prevent redirect loops into auth routes
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('/login') ||
    lower.startsWith('/register') ||
    lower.startsWith('/verify-email') ||
    lower.startsWith('/resend-verification')
  ) {
    return defaultDestination;
  }

  // Role destination separation: prevent ADMIN from being sent to AUTHOR workspace and vice versa
  if (role === 'ADMIN' && trimmed.startsWith('/author')) {
    return defaultDestination;
  }
  if (role === 'AUTHOR' && trimmed.startsWith('/admin')) {
    return defaultDestination;
  }

  return trimmed;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterLink, DynamicFormComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly authApi = inject(AuthApiService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toastService = inject(ToastService);

  readonly submitting = signal<boolean>(false);
  readonly serverError = signal<string | null>(null);
  readonly unverifiedEmail = signal<string | null>(null);

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
    },
    {
      name: 'password',
      label: 'Password',
      type: 'password',
      placeholder: 'Enter your password',
      autocomplete: 'current-password',
      validation: {
        required: true,
      },
    },
    {
      name: 'rememberMe',
      label: 'Remember this device for 30 days',
      type: 'checkbox',
      defaultValue: false,
    },
  ];

  readonly actions: readonly FormActionConfig[] = [
    {
      id: 'submit-login',
      label: 'Sign In',
      type: 'submit',
      variant: 'brand',
    },
  ];

  onSubmit(formValues: Record<string, unknown>): void {
    if (this.submitting()) return;

    const email = typeof formValues['email'] === 'string' ? formValues['email'].trim() : '';
    const password = typeof formValues['password'] === 'string' ? formValues['password'] : '';
    const rememberMe = Boolean(formValues['rememberMe']);

    if (!email || !password) {
      this.serverError.set('Please provide both your email address and password.');
      return;
    }

    const payload: LoginRequest = { email, password, rememberMe };

    this.submitting.set(true);
    this.serverError.set(null);
    this.unverifiedEmail.set(null);

    this.authApi.login(payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.authState.setAuthenticated(response.user);
        this.toastService.success(`Welcome back, ${response.user.email}`);

        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const destination = sanitizeRedirectUrl(returnUrl, response.user.role);
        this.router.navigateByUrl(destination);
      },
      error: (err: unknown) => {
        this.submitting.set(false);

        if (err instanceof HttpErrorResponse) {
          if (err.status === 401) {
            const message = String(err.error?.message ?? '');
            if (message.toLowerCase().includes('verify your email')) {
              this.unverifiedEmail.set(email);
              this.serverError.set('Your email address has not been verified yet. Please check your inbox or request a new link.');
              return;
            }
            this.serverError.set('Invalid email address or password. Please verify your credentials and retry.');
            return;
          }

          if (err.status === 429) {
            this.serverError.set('Too many login attempts. Please wait a moment before trying again.');
            return;
          }

          if (err.status === 400) {
            this.serverError.set('Please provide a valid email address and password.');
            return;
          }
        }

        this.serverError.set('Unable to complete sign in. Please check your network connection and retry.');
      },
    });
  }
}
