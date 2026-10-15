import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

/**
 * VerifyEmailPlaceholderComponent — Scaffold shell for Email Verification.
 */
@Component({
  selector: 'app-verify-email-placeholder',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './verify-email-placeholder.component.html',
  styleUrl: './verify-email-placeholder.component.css',
})
export class VerifyEmailPlaceholderComponent {}
