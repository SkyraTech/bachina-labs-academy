import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { UserProfileApiService } from '../../core/auth/services/user-profile-api.service';
import type { UserProfileResponse } from '../../core/auth/models/user-profile.model';

/**
 * AccountPlaceholderComponent — Account profile and identity settings.
 * Allows authors and admins to view and update their public display name.
 */
@Component({
  selector: 'app-account-placeholder',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-placeholder.component.html',
  styleUrl: './account-placeholder.component.css',
})
export class AccountPlaceholderComponent implements OnInit {
  private readonly profileApi = inject(UserProfileApiService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly profile = signal<UserProfileResponse | null>(null);
  readonly displayNameInput = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly isFallback = computed(() => this.profile()?.isFallback ?? true);
  readonly currentDisplayName = computed(() => this.profile()?.displayName ?? 'Academy Member');

  readonly validationError = computed<string | null>(() => {
    const val = this.displayNameInput().trim();
    if (!val) {
      return 'Display name cannot be empty.';
    }
    if (val.length < 2 || val.length > 50) {
      return 'Display name must be between 2 and 50 characters.';
    }
    if (/@.*\.[a-zA-Z]{2,}/.test(val)) {
      return 'Display name must not resemble an email address.';
    }
    const regex = /^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}\s\-_'.]{0,48}[\p{L}\p{N}\p{M}.]?$/u;
    if (!regex.test(val)) {
      return 'Display name contains invalid characters or starts with a separator.';
    }
    return null;
  });

  readonly isSaveDisabled = computed(() => {
    return (
      this.saving() ||
      this.loading() ||
      !!this.validationError() ||
      this.displayNameInput().trim() === this.currentDisplayName()
    );
  });

  ngOnInit(): void {
    this.fetchProfile();
  }

  fetchProfile(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.profileApi.getProfile().subscribe({
      next: (res) => {
        this.profile.set(res);
        this.displayNameInput.set(res.displayName);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message ?? 'Failed to load user profile.');
        this.loading.set(false);
      },
    });
  }

  saveProfile(): void {
    const err = this.validationError();
    if (err) {
      this.errorMessage.set(err);
      return;
    }

    const trimmed = this.displayNameInput().trim();
    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.profileApi.updateProfile({ displayName: trimmed }).subscribe({
      next: (res) => {
        this.profile.set(res);
        this.displayNameInput.set(res.displayName);
        this.saving.set(false);
        this.successMessage.set('Public display name updated successfully.');
      },
      error: (apiErr) => {
        this.errorMessage.set(apiErr?.error?.message ?? 'Failed to update display name.');
        this.saving.set(false);
      },
    });
  }

  dismissMessages(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }
}
