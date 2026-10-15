import { Routes } from '@angular/router';
import { PublicLayoutComponent } from './layouts/public-layout/public-layout.component';
import { AuthLayoutComponent } from './layouts/auth-layout/auth-layout.component';
import { DashboardLayoutComponent } from './layouts/dashboard-layout/dashboard-layout.component';

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
        loadComponent: () =>
          import('./features/auth/login/login-placeholder.component').then(
            (m) => m.LoginPlaceholderComponent,
          ),
        title: 'Sign In · Bachina Labs Academy',
      },
      {
        path: 'register',
        loadComponent: () =>
          import('./features/auth/register/register-placeholder.component').then(
            (m) => m.RegisterPlaceholderComponent,
          ),
        title: 'Create Account · Bachina Labs Academy',
      },
      {
        path: 'verify-email',
        loadComponent: () =>
          import('./features/auth/verify-email/verify-email-placeholder.component').then(
            (m) => m.VerifyEmailPlaceholderComponent,
          ),
        title: 'Verify Email · Bachina Labs Academy',
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
        loadComponent: () =>
          import('./features/author/author-placeholder.component').then(
            (m) => m.AuthorDashboardPlaceholderComponent,
          ),
        title: 'Author Studio · Bachina Labs Academy',
      },
      {
        path: 'author/articles',
        loadComponent: () =>
          import('./features/author/author-placeholder.component').then(
            (m) => m.AuthorDashboardPlaceholderComponent,
          ),
        title: 'My Articles · Bachina Labs Academy',
      },
      {
        path: 'author/articles/new',
        loadComponent: () =>
          import('./features/author/author-placeholder.component').then(
            (m) => m.AuthorDashboardPlaceholderComponent,
          ),
        title: 'New Article Draft · Bachina Labs Academy',
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./features/admin/admin-placeholder.component').then(
            (m) => m.AdminDashboardPlaceholderComponent,
          ),
        title: 'Admin Control Hub · Bachina Labs Academy',
      },
      {
        path: 'account',
        loadComponent: () =>
          import('./features/account/account-placeholder.component').then(
            (m) => m.AccountPlaceholderComponent,
          ),
        title: 'Account Settings · Bachina Labs Academy',
      },
      {
        path: 'account/security',
        loadComponent: () =>
          import('./features/account/account-placeholder.component').then(
            (m) => m.AccountPlaceholderComponent,
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
