/**
 * Features barrel — re-exports feature route configurations as they are implemented.
 *
 * Planned lazy-loaded feature areas (one sub-folder per feature):
 *   public/       — Home, article list/detail, author pages, category/tag pages, search (Phase 4)
 *   auth/         — Login, register, forgot/reset password (Phase 3)
 *   author/       — Author dashboard, editor, article management (Phase 4)
 *   admin/        — Admin dashboard, user/content/taxonomy management (Phase 5)
 *   subscriptions/— Plan overview, entitlement status (Phase 6)
 *
 * All feature routes are lazy-loaded — never import feature modules eagerly in AppModule.
 * Route guards (AuthGuard, RoleGuard) protect non-public areas at the route level.
 */
export {};
