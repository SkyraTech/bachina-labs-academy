/**
 * Test Database Isolation Guard
 * Enforces strict fail-closed validation of disposable database targets.
 */
export function assertDisposableTestDatabase(
  targetDb: string | undefined | null,
  allowedPrefix?: string,
): void {
  if (!targetDb || typeof targetDb !== 'string' || targetDb.trim() === '') {
    throw new Error('Test database rejection: database name is empty or undefined.');
  }
  const normalized = targetDb.trim().toLowerCase();
  if (normalized === 'bachina_labs_academy') {
    throw new Error(
      'Test database rejection: target database cannot be production or development database "bachina_labs_academy".',
    );
  }
  if (['postgres', 'template0', 'template1'].includes(normalized)) {
    throw new Error(`Test database rejection: target database cannot be system database "${normalized}".`);
  }

  const validPrefixes = allowedPrefix
    ? [allowedPrefix]
    : ['academy_auth_audit_', 'academy_audit_', 'academy_e2e_suite_'];

  const matchedPrefix = validPrefixes.find((p) => normalized.startsWith(p));
  if (!matchedPrefix) {
    throw new Error(
      `Test database rejection: database "${normalized}" does not start with an approved disposable prefix: ${validPrefixes.join(', ')}.`,
    );
  }

  const suffix = normalized.slice(matchedPrefix.length);
  if (!/^[0-9a-f]{8,}$/.test(suffix)) {
    throw new Error(
      `Test database rejection: database "${normalized}" does not have a valid collision-resistant hex suffix.`,
    );
  }
}
