import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { VerifyEmailComponent } from './verify-email.component';
import { AuthApiService } from '../../../core';
import { ToastService } from '../../../shared/ui';

describe('VerifyEmailComponent', () => {
  let component: VerifyEmailComponent;
  let fixture: ComponentFixture<VerifyEmailComponent>;
  let router: Router;
  let authApiSpy: {
    verifyEmail: ReturnType<typeof vi.fn>;
  };
  let toastSpy: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  const setupTestWithToken = async (token: string | null) => {
    authApiSpy = {
      verifyEmail: vi.fn(),
    };
    toastSpy = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [VerifyEmailComponent],
      providers: [
        provideRouter([]),
        { provide: AuthApiService, useValue: authApiSpy },
        { provide: ToastService, useValue: toastSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (key: string) => (key === 'token' ? token : null),
              },
            },
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));

    fixture = TestBed.createComponent(VerifyEmailComponent);
    component = fixture.componentInstance;
  };

  it('should transition to missing_token when no token query parameter is present', async () => {
    await setupTestWithToken(null);
    fixture.detectChanges();

    expect(component.state()).toBe('missing_token');
    expect(authApiSpy.verifyEmail).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('should sanitize URL immediately and verify valid token on load', async () => {
    await setupTestWithToken('valid-base64url-token-12345678901234567890123');
    authApiSpy.verifyEmail.mockReturnValue(
      of({
        verified: true,
        message: 'Your email address has been verified.',
      }),
    );

    fixture.detectChanges();

    // Verification initiated
    expect(router.navigate).toHaveBeenCalledWith([], {
      replaceUrl: true,
      queryParams: {},
    });
    expect(authApiSpy.verifyEmail).toHaveBeenCalledWith({
      token: 'valid-base64url-token-12345678901234567890123',
    });
    expect(component.state()).toBe('verified');
    expect(toastSpy.success).toHaveBeenCalledWith('Your email address has been verified.');

    fixture.detectChanges();
    const title = fixture.nativeElement.querySelector('.auth-title');
    expect(title.textContent).toContain('Email verified!');
  });

  it('should handle invalid or expired token (400) by transitioning to invalid_or_expired state', async () => {
    await setupTestWithToken('expired-token-12345678901234567890123456789');
    const errorResponse = new HttpErrorResponse({
      status: 400,
      error: { message: 'Token is invalid, expired, or has already been used' },
    });
    authApiSpy.verifyEmail.mockReturnValue(throwError(() => errorResponse));

    fixture.detectChanges();

    expect(component.state()).toBe('invalid_or_expired');
    expect(component.errorMessage()).toContain('invalid, has expired, or has already been used');

    fixture.detectChanges();
    const title = fixture.nativeElement.querySelector('.auth-title');
    expect(title.textContent).toContain('Link invalid or expired');
  });

  it('should handle network error and allow retry', async () => {
    await setupTestWithToken('token-with-network-glitch-123456789012345');
    const networkError = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
    authApiSpy.verifyEmail.mockReturnValue(throwError(() => networkError));

    fixture.detectChanges();

    expect(component.state()).toBe('network_error');

    // Test retry
    authApiSpy.verifyEmail.mockReturnValue(
      of({ verified: true, message: 'Your email address has been verified.' }),
    );
    component.retry();

    expect(component.state()).toBe('verified');
  });
});
