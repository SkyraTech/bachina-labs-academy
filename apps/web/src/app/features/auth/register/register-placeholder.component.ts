import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

/**
 * RegisterPlaceholderComponent — High-fidelity Registration UI Shell.
 */
@Component({
  selector: 'app-register-placeholder',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './register-placeholder.component.html',
  styleUrl: './register-placeholder.component.css',
})
export class RegisterPlaceholderComponent {}
