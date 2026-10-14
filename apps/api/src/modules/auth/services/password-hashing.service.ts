import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { hash, verify, argon2id } from 'argon2';
import type { HashOptions } from 'argon2';

/**
 * PasswordHashingService — owns all Argon2id hashing operations.
 *
 * Responsibilities:
 *   - Hash passwords using Argon2id with OWASP-aligned parameters.
 *   - Verify plaintext passwords against stored hashes.
 *
 * Security rules:
 *   - NEVER log the plaintext password, the resulting hash, or any partial
 *     content of either.
 *   - NEVER throw raw errors from argon2 that might expose hash values or
 *     internal configuration details to callers.
 *   - This service does not validate password policy — that belongs in the DTO.
 *   - Do not call this service with an empty or whitespace-only password.
 *     The caller (RegistrationService) is responsible for receiving a
 *     policy-compliant password from the validated DTO.
 *
 * Argon2id parameters (OWASP-recommended minimums for 2024+):
 *   - type:        argon2id (resists both side-channel and GPU attacks)
 *   - memoryCost:  19456 KiB (19 MiB)
 *   - timeCost:    2 iterations
 *   - parallelism: 1 thread
 *   - hashLength:  32 bytes (256-bit output)
 *
 * argon2 auto-generates a cryptographically secure random salt per hash call.
 */
@Injectable()
export class PasswordHashingService {
  private readonly logger = new Logger(PasswordHashingService.name);

  private readonly hashOptions: HashOptions = {
    type: argon2id,
    memoryCost: 19456, // 19 MiB in KiB
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  };

  /**
   * Hashes a plaintext password using Argon2id.
   *
   * @param plaintext — the raw password string from the registration DTO.
   *   Must be policy-compliant (12–128 chars). Not validated here.
   * @returns the Argon2id hash string (includes algorithm, params, salt and digest)
   * @throws InternalServerErrorException if hashing fails — without leaking details
   */
  async hash(plaintext: string): Promise<string> {
    try {
      return await hash(plaintext, this.hashOptions);
    } catch {
      // Do not log the error directly — it could reference the plaintext or hash
      this.logger.error('Password hashing failed');
      throw new InternalServerErrorException(
        'An error occurred while processing your request',
      );
    }
  }

  /**
   * Verifies a plaintext password against a stored Argon2id hash.
   *
   * @param storedHash — the stored hash string
   * @param plaintext — the candidate plaintext to verify
   * @returns true if the password matches the hash, false otherwise
   * @throws InternalServerErrorException if verification itself errors
   */
  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(storedHash, plaintext);
    } catch {
      this.logger.error('Password verification failed');
      throw new InternalServerErrorException(
        'An error occurred while processing your request',
      );
    }
  }
}
