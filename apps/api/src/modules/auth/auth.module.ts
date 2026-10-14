import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { UsersRepository } from '../users/users.repository.js';
import { AuthController } from './controllers/auth.controller.js';
import { RegistrationService } from './services/registration.service.js';
import { PasswordHashingService } from './services/password-hashing.service.js';

/**
 * AuthModule — NestJS module for authentication workflows.
 *
 * Phase 2.2.2 scope:
 *   POST /api/v1/auth/register — email/password registration.
 *
 * Architecture:
 *   AuthController        → accepts HTTP requests, delegates to services.
 *   RegistrationService   → orchestrates registration business logic.
 *   PasswordHashingService → Argon2id hashing and verification.
 *   UsersRepository       → direct data access for user creation.
 *   UsersService          → injected via UsersModule for email lookups.
 *
 * Why AuthModule imports UsersModule AND provides UsersRepository directly:
 *   - UsersModule exports UsersService for email lookups (findByEmail).
 *   - UsersRepository is also provided here because RegistrationService needs
 *     to call createUser, which is a write operation. UsersModule does not
 *     export UsersRepository (it has no reason to expose mutations publicly).
 *   - Both can coexist because PrismaService is global (DatabaseModule) and
 *     a second registration of UsersRepository in AuthModule does not create
 *     a second DB connection — it reuses the same PrismaService instance.
 *
 * Future additions (each in its own approved phase):
 *   - LoginService       — password verification and session issuance (Phase 3)
 *   - LogoutService      — session revocation (Phase 3)
 *   - GoogleOAuthService — OAuth identity linking (Phase 4)
 */
@Module({
  imports: [
    UsersModule, // provides UsersService (exports it)
  ],
  controllers: [AuthController],
  providers: [
    RegistrationService,
    PasswordHashingService,
    UsersRepository, // needed for createUser — UsersModule does not export it
  ],
})
export class AuthModule {}
