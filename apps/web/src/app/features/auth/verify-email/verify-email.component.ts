import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthApiService } from '../../../core';
import { ToastService } from '../../../shared/ui';

export type VerificationState =
  | 'verifying'
  | 'verified'
  | 'invalid_or_expired'
  | 'missing_token'
  | 'network_error';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './verify-email.component.html',
  styleUrl: './verify-email.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VerifyEmailComponent implements OnInit {
  private readonly authApi = inject(AuthApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);

  readonly state = signal<VerificationState>('verifying');
  readonly errorMessage = signal<string | null>(null);

  /** Private reference to the single-use token held in memory only */
  private verificationToken: string | null = null;
  private hasTriggered = false;

  ngOnInit(): void {
    if (this.hasTriggered) return;
    this.hasTriggered = true;

    // 1. Read token from URL query parameters
    const token = this.route.snapshot.queryParamMap.get('token');

    if (!token) {
      this.state.set('missing_token');
      return;
    }

    this.verificationToken = token;

    // 2. Sanitize visible browser URL immediately to prevent token leakage in history or referrers
    this.router.navigate([], {
      replaceUrl: true,
      queryParams: {},
    });

    // 3. Initiate verification
    this.verifyToken();
  }

  retry(): void {
    if (!this.verificationToken) {
      this.state.set('missing_token');
      return;
    }
    this.verifyToken();
  }

  private verifyToken(): void {
    if (!this.verificationToken) return;

    this.state.set('verifying');
    this.errorMessage.set(null);

    this.authApi.verifyEmail({ token: this.verificationToken }).subscribe({
      next: (res) => {
        this.state.set('verified');
        this.toastService.success(res.message ?? 'Email verified successfully!');
        // Clear token from memory after single use
        this.verificationToken = null;
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse) {
          if (err.status === 400) {
            this.state.set('invalid_or_expired');
            this.errorMessage.set(
              'This email verification link is invalid, has expired, or has already been used.',
            );
            return;
          }
          if (err.status === 429) {
            this.state.set('invalid_or_expired');
            this.errorMessage.set(
              'Too many verification attempts. Please wait a few moments before requesting a new link.',
            );
            return;
          }
        }
        this.state.set('network_error');
        this.errorMessage.set(
          'Unable to complete verification due to a network or server issue. Please try again.',
        );
      },
    });
  }
}
