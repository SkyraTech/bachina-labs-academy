import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

/**
 * LoginPlaceholderComponent — High-fidelity Authentication UI Shell.
 */
@Component({
  selector: 'app-login-placeholder',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login-placeholder.component.html',
  styleUrl: './login-placeholder.component.css',
})
export class LoginPlaceholderComponent {}
