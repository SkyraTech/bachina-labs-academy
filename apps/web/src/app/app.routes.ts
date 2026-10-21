import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';
import { PublicLayoutComponent } from './layouts/public-layout/public-layout.component';
import { AuthLayoutComponent } from './layouts/auth-layout/auth-layout.component';
import { DashboardLayoutComponent } from './layouts/dashboard-layout/dashboard-layout.component';
import { authGuard, guestGuard, roleGuard } from './core';

/**
 * Isolated development-only showcase routes.
 * Excluded in production builds when isDevMode() evaluates to false.
 */
const devRoutes: Routes = isDevMode()
  ? [
      {
        path: 'dev/showcase',
        loadComponent: () =>
          import('./features/dev-showcase/showcase.component').then((m) => m.ShowcaseComponent),
        title: 'UI Component Showcase · Bachina Labs Academy (Dev Only)',
      },
    ]
  : [];

/**
 * Bachina Labs Academy — Application Route Configuration.
 *
 * Implements lazy loading for all feature page components:
 * - Public area with PublicLayoutComponent
 * - Authentication flows with AuthLayoutComponent
 * - Author / Admin / Account workspaces with DashboardLayoutComponent
 * - 404 Not Found fallback
 */
export const routes: Routes = [
  ...devRoutes,
  // Public Platform Routes
  {
    path: '',
    component: PublicLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/public/home/home.component').then((m) => m.HomeComponent),
        title: 'Bachina Labs Academy — Engineering Knowledge Platform',
      },
      {
        path: 'articles',
        loadComponent: () =>
          import('./features/public/articles/articles-placeholder.component').then(
            (m) => m.ArticlesPlaceholderComponent,
          ),
        title: 'Articles · Bachina Labs Academy',
      },
      {
        path: 'articles/:slug',
        loadComponent: () =>
          import('./features/public/articles/articles-placeholder.component').then(
            (m) => m.ArticlesPlaceholderComponent,
          ),
        title: 'Article Detail · Bachina Labs Academy',
      },
    ],
  },

  // Authentication Routes
  {
    path: '',
    component: AuthLayoutComponent,
    children: [
      {
        path: 'login',
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/auth/login/login.component').then((m) => m.LoginComponent),
        title: 'Sign In · Bachina Labs Academy',
      },
      {
        path: 'register',
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/auth/register/register.component').then((m) => m.RegisterComponent),
        title: 'Create Account · Bachina Labs Academy',
      },
      {
        path: 'verify-email',
        loadComponent: () =>
          import('./features/auth/verify-email/verify-email.component').then(
            (m) => m.VerifyEmailComponent,
          ),
        title: 'Verify Email · Bachina Labs Academy',
      },
      {
        path: 'resend-verification',
        loadComponent: () =>
          import('./features/auth/resend-verification/resend-verification.component').then(
            (m) => m.ResendVerificationComponent,
          ),
        title: 'Resend Verification · Bachina Labs Academy',
      },
    ],
  },

  // Workspaces (Author, Admin, Account)
  {
    path: '',
    component: DashboardLayoutComponent,
    children: [
      {
        path: 'author',
        canActivate: [authGuard, roleGuard(['AUTHOR'])],
        loadComponent: () =>
          import('./features/author/author-placeholder.component').then(
            (m) => m.AuthorDashboardPlaceholderComponent,
          ),
        title: 'Author Studio · Bachina Labs Academy',
      },
      {
        path: 'author/articles',
        canActivate: [authGuard, roleGuard(['AUTHOR'])],
        loadComponent: () =>
          import('./features/author/author-placeholder.component').then(
            (m) => m.AuthorDashboardPlaceholderComponent,
          ),
        title: 'My Articles · Bachina Labs Academy',
      },
      {
        path: 'author/articles/new',
        canActivate: [authGuard, roleGuard(['AUTHOR'])],
        loadComponent: () =>
          import('./features/author/author-placeholder.component').then(
            (m) => m.AuthorDashboardPlaceholderComponent,
          ),
        title: 'New Article Draft · Bachina Labs Academy',
      },
      {
        path: 'admin',
        canActivate: [authGuard, roleGuard(['ADMIN'])],
        loadComponent: () =>
          import('./features/admin/admin-placeholder.component').then(
            (m) => m.AdminDashboardPlaceholderComponent,
          ),
        title: 'Admin Control Hub · Bachina Labs Academy',
      },
      {
        path: 'account',
        canActivate: [authGuard, roleGuard(['AUTHOR', 'ADMIN'])],
        loadComponent: () =>
          import('./features/account/account-placeholder.component').then(
            (m) => m.AccountPlaceholderComponent,
          ),
        title: 'Account Settings · Bachina Labs Academy',
      },
      {
        path: 'account/security',
        canActivate: [authGuard, roleGuard(['AUTHOR', 'ADMIN'])],
        loadComponent: () =>
          import('./features/account/security/security.component').then(
            (m) => m.SecurityComponent,
          ),
        title: 'Account Security · Bachina Labs Academy',
      },
    ],
  },

  // 404 Wildcard Fallback Route
  {
    path: '**',
    component: PublicLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/public/not-found/not-found.component').then(
            (m) => m.NotFoundComponent,
          ),
        title: 'Page Not Found · Bachina Labs Academy',
      },
    ],
  },
];
