/**
 * Layouts barrel — re-exports layout shell components as they are implemented.
 *
 * Planned contents (Phase 4):
 *   public-layout/    — PublicLayoutComponent (nav + footer for public site)
 *   author-layout/    — AuthorLayoutComponent (sidebar + author nav)
 *   admin-layout/     — AdminLayoutComponent (admin sidebar + nav)
 *   auth-layout/      — AuthLayoutComponent (centered card layout)
 *
 * Layouts use shared components from shared/ and define route-level shells.
 * Only one layout is rendered at a time via named <router-outlet>.
 */
export {};
