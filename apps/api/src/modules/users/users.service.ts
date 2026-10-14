import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';
import type { SafeUser, UserLookupResult } from './types/index.js';

/**
 * UsersService — application service layer for the users domain.
 *
 * Responsibilities:
 *   - Orchestrate repository calls and apply domain logic.
 *   - Normalize email input consistently at the application boundary.
 *   - Return safe user representations — never password hashes.
 *   - Provide a clean, typed interface for other modules (e.g. AuthModule).
 *
 * Rules:
 *   - Domain logic lives here, NOT in the repository.
 *   - NEVER expose passwordHash in return values.
 *   - NEVER log passwords, hashes, or raw credential input.
 *   - Email is normalized to lowercase and trimmed before every query.
 *     This ensures consistent lookup behaviour that aligns with the
 *     LOWER(email) database uniqueness index.
 *   - Do not add registration, login, password-reset or verification
 *     workflows here — those belong in a dedicated AuthService (Phase 3).
 *
 * Methods provided are intentionally minimal for the Users domain foundation.
 * They will be consumed by AuthModule in the authentication step.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly usersRepository: UsersRepository) {}

  /**
   * Normalizes an email address for consistent storage and lookup.
   * Must be applied at every application entry point before a user
   * email is persisted or queried.
   *
   * @param email — raw email string from input
   * @returns lowercase, whitespace-trimmed email
   */
  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Finds a user by their UUID primary key.
   * Returns null when the user does not exist — does not throw.
   * Use findByIdOrThrow when you need a guaranteed result.
   *
   * @param id — user UUID
   * @returns SafeUser | null
   */
  async findById(id: string): Promise<UserLookupResult> {
    this.logger.debug(`findById called for id: ${id}`);
    return this.usersRepository.findById(id);
  }

  /**
   * Finds a user by their UUID primary key.
   * Throws NotFoundException when the user does not exist.
   * Use findById when a null result is acceptable.
   *
   * @param id — user UUID
   * @returns SafeUser
   * @throws NotFoundException if no user with the given id exists
   */
  async findByIdOrThrow(id: string): Promise<SafeUser> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      this.logger.warn(`findByIdOrThrow: user not found for id: ${id}`);
      throw new NotFoundException(`User not found`);
    }
    return user;
  }

  /**
   * Finds a user by their email address.
   * Email is normalized before the lookup.
   * Returns null when the user does not exist — does not throw.
   *
   * @param email — raw (un-normalized) email address
   * @returns SafeUser | null
   */
  async findByEmail(email: string): Promise<UserLookupResult> {
    const normalized = this.normalizeEmail(email);
    // Log at debug without including the email value itself
    this.logger.debug('findByEmail called');
    return this.usersRepository.findByEmail(normalized);
  }
}
