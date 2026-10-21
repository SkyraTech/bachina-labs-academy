import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { RegisterComponent } from './register.component';
import { AuthApiService } from '../../../core';
import { ToastService } from '../../../shared/ui';

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  let authApiSpy: {
    register: ReturnType<typeof vi.fn>;
  };
  let toastSpy: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authApiSpy = {
      register: vi.fn(),
    };
    toastSpy = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        provideRouter([]),
        { provide: AuthApiService, useValue: authApiSpy },
        { provide: ToastService, useValue: toastSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the register component with configured fields', () => {
    expect(component).toBeTruthy();
    expect(component.fields.length).toBe(2);
    expect(component.fields[0].name).toBe('email');
    expect(component.fields[1].name).toBe('password');
    expect(component.fields[1].validation?.minLength).toBe(12);
    expect(component.fields[1].validation?.maxLength).toBe(128);
  });

  it('should submit valid credentials and render success state on 201 response', () => {
    authApiSpy.register.mockReturnValue(
      of({
        id: 'new-user-uuid',
        email: 'test@skyra-tech.com',
        role: 'AUTHOR',
        status: 'ACTIVE',
        emailVerifiedAt: null,
        createdAt: '2026-10-15T00:00:00Z',
        updatedAt: '2026-10-15T00:00:00Z',
      }),
    );

    component.onSubmit({
      email: 'test@skyra-tech.com',
      password: 'valid-long-password-1234',
    });

    expect(authApiSpy.register).toHaveBeenCalledWith({
      email: 'test@skyra-tech.com',
      password: 'valid-long-password-1234',
    });
    expect(component.submitting()).toBe(false);
    expect(component.registrationSuccess()).toEqual({ email: 'test@skyra-tech.com' });
    expect(toastSpy.success).toHaveBeenCalledWith('Registration successful! Please verify your email.');

    fixture.detectChanges();
    const successTitle = fixture.nativeElement.querySelector('.auth-title');
    expect(successTitle.textContent).toContain('Check your inbox');
  });

  it('should display conflict error when account already exists (409)', () => {
    const errorResponse = new HttpErrorResponse({
      status: 409,
      error: { message: 'An account with this email address already exists.' },
    });
    authApiSpy.register.mockReturnValue(throwError(() => errorResponse));

    component.onSubmit({
      email: 'existing@skyra-tech.com',
      password: 'valid-long-password-1234',
    });

    expect(component.submitting()).toBe(false);
    expect(component.serverError()).toContain('already exists. Please sign in instead.');
    expect(component.registrationSuccess()).toBeNull();
  });

  it('should display rate limit error on 429 response', () => {
    const errorResponse = new HttpErrorResponse({
      status: 429,
      error: { message: 'Too Many Requests' },
    });
    authApiSpy.register.mockReturnValue(throwError(() => errorResponse));

    component.onSubmit({
      email: 'test@skyra-tech.com',
      password: 'valid-long-password-1234',
    });

    expect(component.serverError()).toContain('Too many registration attempts');
  });

  it('should prevent duplicate submission while already submitting', () => {
    component.submitting.set(true);
    component.onSubmit({
      email: 'test@skyra-tech.com',
      password: 'valid-long-password-1234',
    });

    expect(authApiSpy.register).not.toHaveBeenCalled();
  });
});
