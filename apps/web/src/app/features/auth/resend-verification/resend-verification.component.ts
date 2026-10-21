import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  DynamicFormComponent,
  FormActionConfig,
  FormFieldConfig,
  ToastService,
} from '../../../shared/ui';
import { AuthApiService, ResendVerificationRequest } from '../../../core';

@Component({
  selector: 'app-resend-verification',
  standalone: true,
  imports: [CommonModule, RouterLink, DynamicFormComponent],
  templateUrl: './resend-verification.component.html',
  styleUrl: './resend-verification.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResendVerificationComponent implements OnInit {
  private readonly authApi = inject(AuthApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly submitting = signal<boolean>(false);
  readonly serverError = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly cooldownRemaining = signal<number>(0);

  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  fields: FormFieldConfig[] = [
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
      hint: 'Enter the email address registered with your account.',
    },
  ];

  readonly actions: readonly FormActionConfig[] = [
    {
      id: 'submit-resend',
      label: 'Send Verification Link',
      type: 'submit',
      variant: 'brand',
    },
  ];

  ngOnInit(): void {
    const prefilledEmail = this.route.snapshot.queryParamMap.get('email');
    if (prefilledEmail) {
      this.fields = [
        {
          ...this.fields[0],
          defaultValue: prefilledEmail,
        },
      ];
    }

    this.destroyRef.onDestroy(() => {
      this.clearCooldownTimer();
    });
  }

  onSubmit(formValues: Record<string, unknown>): void {
    if (this.submitting() || this.cooldownRemaining() > 0) return;

    const email = typeof formValues['email'] === 'string' ? formValues['email'].trim() : '';
    if (!email) {
      this.serverError.set('Please provide a valid email address.');
      return;
    }

    const payload: ResendVerificationRequest = { email };

    this.submitting.set(true);
    this.serverError.set(null);
    this.successMessage.set(null);

    this.authApi.resendVerification(payload).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.successMessage.set(
          res.message ??
            'If an account exists for that address, a verification email has been sent.',
        );
        this.toastService.info('Verification request accepted.');
        this.startCooldown(60);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        if (err instanceof HttpErrorResponse) {
          if (err.status === 429) {
            this.serverError.set('Too many verification requests. Please wait before retrying.');
            return;
          }
          if (err.status === 400) {
            this.serverError.set('Please provide a valid email address.');
            return;
          }
        }
        this.serverError.set('Unable to dispatch verification email. Please check your connection and retry.');
      },
    });
  }

  private startCooldown(seconds: number): void {
    this.clearCooldownTimer();
    this.cooldownRemaining.set(seconds);

    this.cooldownTimer = setInterval(() => {
      const remaining = this.cooldownRemaining() - 1;
      if (remaining <= 0) {
        this.cooldownRemaining.set(0);
        this.clearCooldownTimer();
      } else {
        this.cooldownRemaining.set(remaining);
      }
    }, 1000);
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }
}
