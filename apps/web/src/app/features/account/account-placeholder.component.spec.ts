import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccountPlaceholderComponent } from './account-placeholder.component';
import { UserProfileApiService } from '../../core/auth/services/user-profile-api.service';
import type { UserProfileResponse } from '../../core/auth/models/user-profile.model';

describe('AccountPlaceholderComponent', () => {
  let component: AccountPlaceholderComponent;
  let fixture: ComponentFixture<AccountPlaceholderComponent>;
  let mockProfileApi: {
    getProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
  };

  const fallbackProfile: UserProfileResponse = {
    id: null,
    userId: 'user-1',
    displayName: 'Academy Member',
    isFallback: true,
    createdAt: null,
    updatedAt: null,
  };

  const customProfile: UserProfileResponse = {
    id: 'p-1',
    userId: 'user-1',
    displayName: 'Dr. Jane PostgreSQL',
    isFallback: false,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockProfileApi = {
      getProfile: vi.fn().mockReturnValue(of(fallbackProfile)),
      updateProfile: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AccountPlaceholderComponent],
      providers: [
        provideRouter([]),
        { provide: UserProfileApiService, useValue: mockProfileApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountPlaceholderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('initializes with fallback profile', () => {
    expect(mockProfileApi.getProfile).toHaveBeenCalled();
    expect(component.profile()).toEqual(fallbackProfile);
    expect(component.isFallback()).toBe(true);
    expect(component.displayNameInput()).toBe('Academy Member');
  });

  it('validates invalid display names', () => {
    component.displayNameInput.set('a');
    expect(component.validationError()).toBe('Display name must be between 2 and 50 characters.');

    component.displayNameInput.set('user@domain.com');
    expect(component.validationError()).toBe('Display name must not resemble an email address.');

    component.displayNameInput.set('Valid Display Name');
    expect(component.validationError()).toBeNull();
  });

  it('disables save button when unchanged or invalid', () => {
    // Unchanged fallback
    component.displayNameInput.set('Academy Member');
    expect(component.isSaveDisabled()).toBe(true);

    // Invalid
    component.displayNameInput.set('x');
    expect(component.isSaveDisabled()).toBe(true);

    // Valid and changed
    component.displayNameInput.set('Dr. Jane PostgreSQL');
    expect(component.isSaveDisabled()).toBe(false);
  });

  it('saves updated display name successfully', () => {
    mockProfileApi.updateProfile.mockReturnValue(of(customProfile));
    component.displayNameInput.set('Dr. Jane PostgreSQL');

    component.saveProfile();

    expect(mockProfileApi.updateProfile).toHaveBeenCalledWith({
      displayName: 'Dr. Jane PostgreSQL',
    });
    expect(component.profile()).toEqual(customProfile);
    expect(component.successMessage()).toBe('Public display name updated successfully.');
  });

  it('displays error message when API call fails', () => {
    mockProfileApi.updateProfile.mockReturnValue(
      throwError(() => ({ error: { message: 'Display name invalid.' } })),
    );
    component.displayNameInput.set('Dr. Jane PostgreSQL');

    component.saveProfile();

    expect(component.errorMessage()).toBe('Display name invalid.');
    expect(component.saving()).toBe(false);
  });
});

