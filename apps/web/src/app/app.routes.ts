import { Routes } from '@angular/router';

/**
 * Application root route configuration.
 *
 * All feature areas are lazy-loaded to minimize initial bundle size.
 * Route guards (AuthGuard, RoleGuard) will be added in Phase 3.
 *
 * Planned lazy routes (added per phase):
 *   { path: '', loadChildren: () => import('./features/public/public.routes') } // Phase 4
 *   { path: 'auth', loadChildren: () => import('./features/auth/auth.routes') } // Phase 3
 *   { path: 'author', loadChildren: () => import('./features/author/author.routes') } // Phase 4
 *   { path: 'admin', loadChildren: () => import('./features/admin/admin.routes') } // Phase 5
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    // Temporary root redirect — will be replaced with PublicLayoutComponent in Phase 4
    redirectTo: '',
  },
  {
    path: '**',
    // 404 component will be added in Phase 4 with the public layout
    redirectTo: '',
  },
];
