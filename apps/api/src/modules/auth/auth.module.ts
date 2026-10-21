import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module.js';
import { UsersRepository } from '../users/users.repository.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthController } from './controllers/auth.controller.js';
import { RegistrationService } from './services/registration.service.js';
import { PasswordHashingService } from './services/password-hashing.service.js';
import { EmailVerificationService } from './services/email-verification.service.js';
import { VerificationTokenService } from './services/verification-token.service.js';
import { EmailVerificationTokenRepository } from './repositories/email-verification-token.repository.js';
import { RefreshTokenService } from './services/refresh-token.service.js';
import { JwtTokenService } from './services/jwt-token.service.js';
import { CookieService } from './services/cookie.service.js';
import { LoginService } from './services/login.service.js';
import { LogoutService } from './services/logout.service.js';
import { AuthAbuseService } from './services/auth-abuse.service.js';
import { JwtAccessGuard } from './guards/jwt-access.guard.js';
import { OriginGuard } from './guards/origin.guard.js';
import { RolesGuard } from '../../common/authorization/guards/roles.guard.js';
import { VerifiedEmailGuard } from '../../common/authorization/guards/verified-email.guard.js';

@Module({
  imports: [
    UsersModule,
    SessionsModule,
    AuditModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    RegistrationService,
    PasswordHashingService,
    EmailVerificationService,
    VerificationTokenService,
    EmailVerificationTokenRepository,
    UsersRepository,
    RefreshTokenService,
    JwtTokenService,
    CookieService,
    AuthAbuseService,
    LoginService,
    LogoutService,
    OriginGuard,
    JwtAccessGuard,
    RolesGuard,
    VerifiedEmailGuard,
    {
      provide: APP_GUARD,
      useClass: OriginGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAccessGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [
    JwtTokenService,
    JwtAccessGuard,
    RolesGuard,
    VerifiedEmailGuard,
    AuthAbuseService,
    LoginService,
    LogoutService,
  ],
})
export class AuthModule {}
