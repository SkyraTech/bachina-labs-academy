import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ResendVerificationComponent } from './resend-verification.component';
import { AuthApiService } from '../../../core';
import { ToastService } from '../../../shared/ui';

describe('ResendVerificationComponent', () => {
  let component: ResendVerificationComponent;
  let fixture: ComponentFixture<ResendVerificationComponent>;
  let authApiSpy: {
    resendVerification: ReturnType<typeof vi.fn>;
  };
  let toastSpy: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authApiSpy = {
      resendVerification: vi.fn(),
    };
    toastSpy = {
      info: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ResendVerificationComponent],
      providers: [
        provideRouter([]),
        { provide: AuthApiService, useValue: authApiSpy },
        { provide: ToastService, useValue: toastSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (key: string) => (key === 'email' ? 'prefill@skyra-tech.com' : null),
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResendVerificationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should initialize with prefilled email from query parameter if provided', () => {
    expect(component).toBeTruthy();
    expect(component.fields[0].defaultValue).toBe('prefill@skyra-tech.com');
  });

  it('should submit email, show generic message, and start cooldown on success', () => {
    vi.useFakeTimers();
    try {
      authApiSpy.resendVerification.mockReturnValue(
        of({
          status: 202,
          message: 'If an account exists for that address, a verification email has been sent.',
        }),
      );

      component.onSubmit({ email: 'author@skyra-tech.com' });

      expect(authApiSpy.resendVerification).toHaveBeenCalledWith({
        email: 'author@skyra-tech.com',
      });
      expect(component.submitting()).toBe(false);
      expect(component.successMessage()).toContain('If an account exists for that address');
      expect(component.cooldownRemaining()).toBe(60);

      // Advance 10 seconds
      vi.advanceTimersByTime(10000);
      expect(component.cooldownRemaining()).toBe(50);

      // Try submitting again during cooldown -> should be blocked
      authApiSpy.resendVerification.mockClear();
      component.onSubmit({ email: 'author@skyra-tech.com' });
      expect(authApiSpy.resendVerification).not.toHaveBeenCalled();

      // Advance remainder of timer
      vi.advanceTimersByTime(50000);
      expect(component.cooldownRemaining()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should handle rate limit 429 response', () => {
    const errorResponse = new HttpErrorResponse({
      status: 429,
      error: { message: 'Too Many Requests' },
    });
    authApiSpy.resendVerification.mockReturnValue(throwError(() => errorResponse));

    component.onSubmit({ email: 'author@skyra-tech.com' });

    expect(component.serverError()).toContain('Too many verification requests');
  });
});
