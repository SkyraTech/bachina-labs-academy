/**
 * Injection tokens for the email subsystem.
 *
 * These live in their own file, deliberately separate from email.module.ts.
 * EmailModule needs the provider token to register the factory, and
 * EmailService needs the same token to inject the result. Defining the constant
 * inside email.module.ts would make email.service.ts import from the module
 * while the module imports the service — a genuine ES module cycle, which Nest
 * reports as a circular dependency and which custom (factory) providers cannot
 * resolve with forwardRef.
 *
 * A tokens file is the standard way to break that cycle: both sides import a
 * leaf module that imports neither.
 */

/** Injection token for the concrete transport provider. */
export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';
