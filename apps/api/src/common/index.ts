/**
 * src/common/README (non-Markdown)
 *
 * This directory contains cross-cutting infrastructure:
 *   filters/          — Global exception filters (HttpExceptionFilter, AllExceptionsFilter)
 *   guards/           — Role guards, auth guards, entitlement guards
 *   interceptors/     — Logging, response transform interceptors
 *   decorators/       — Custom parameter decorators (CurrentUser, Public, etc.)
 *   pipes/            — Custom validation pipes
 *   types/            — Shared TypeScript types and interfaces
 *
 * These will be implemented in Phase 3 (Auth) and later phases.
 * Do not add domain business logic here — domain logic belongs in module services.
 */
export {};
