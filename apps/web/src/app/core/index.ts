/**
 * Core barrel — re-exports core infrastructure as it is implemented.
 *
 * Planned contents (to be added per phase):
 *   auth/          — AuthService, AuthGuard, token interceptor (Phase 3)
 *   http/          — ApiService, typed HTTP client wrappers (Phase 3)
 *   theme/         — ThemeService (light/dark/system), ThemeInitializer
 *   entitlements/  — EntitlementService (Phase 6)
 *   guards/        — AuthGuard, RoleGuard route guards (Phase 3)
 *
 * Only infrastructure used across 3+ features belongs here.
 * Do not place business/feature logic in core.
 */
export {};
