import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { RegistrationService } from '../services/registration.service.js';
import { EmailVerificationService } from '../services/email-verification.service.js';
import { LoginService } from '../services/login.service.js';
import { LogoutService } from '../services/logout.service.js';
import { RegisterRequestDto } from '../dto/register-request.dto.js';
import { RegisterResponseDto } from '../dto/register-response.dto.js';
import { VerifyEmailRequestDto } from '../dto/verify-email-request.dto.js';
import { VerifyEmailResponseDto } from '../dto/verify-email-response.dto.js';
import { ResendVerificationRequestDto } from '../dto/resend-verification-request.dto.js';
import { ResendVerificationResponseDto } from '../dto/resend-verification-response.dto.js';
import { LoginRequestDto } from '../dto/login-request.dto.js';
import { LoginResponseDto } from '../dto/login-response.dto.js';
import { RefreshResponseDto } from '../dto/refresh-response.dto.js';
import { CurrentUserResponseDto } from '../dto/current-user-response.dto.js';
import { LogoutResponseDto } from '../dto/logout-response.dto.js';
import { LogoutAllResponseDto } from '../dto/logout-all-response.dto.js';
import { ActiveSessionResponseDto } from '../dto/active-session-response.dto.js';
import { RevokeSessionResponseDto } from '../dto/revoke-session-response.dto.js';
import { Public } from '../decorators/public.decorator.js';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { REFRESH_COOKIE_NAME } from '../services/cookie.service.js';
import type { AuthenticatedUser } from '../types/jwt.types.js';
import type { SafeUser } from '../../users/types/index.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registrationService: RegistrationService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly loginService: LoginService,
    private readonly logoutService: LogoutService,
  ) {}

  /**
   * POST /api/v1/auth/register
   *
   * Registers a new email/password account.
   *
   * - Returns 201 Created on success with the safe user representation.
   * - Returns 400 Bad Request for validation failures.
   * - Returns 409 Conflict for duplicate emails.
   * - Returns 429 Too Many Requests when the rate limit is exceeded.
   *
   * The newly registered account is NOT authenticated. No session or token
   * is issued, and emailVerifiedAt is null until the user completes
   * POST /verify-email.
   *
   * A verification email is issued after the account is committed. Delivery
   * failure does NOT fail this request and does NOT delete the account — the
   * user recovers through POST /resend-verification.
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Creates a new email/password account with the AUTHOR role and sends a ' +
      'verification email. Does not issue a session or access token. ' +
      'Email verification is required before publishing content.',
  })
  @ApiCreatedResponse({
    description: 'Account registered successfully',
    type: RegisterResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed — invalid email, policy-violating password, or unexpected fields',
  })
  @ApiConflictResponse({
    description: 'An account with this email address already exists',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many registration attempts — please wait before retrying',
  })
  async register(@Body() dto: RegisterRequestDto): Promise<RegisterResponseDto> {
    const user: SafeUser = await this.registrationService.register(dto);
    return this.toResponseDto(user);
  }

  /**
   * POST /api/v1/auth/verify-email
   *
   * Consumes a single-use verification token and marks the account verified.
   *
   * - Returns 200 OK on success.
   * - Returns 400 Bad Request for an invalid, expired or already-used token.
   *     All three share one message and one status so the endpoint cannot be
   *     used to test whether a stolen token is genuine.
   * - Returns 429 Too Many Requests when the rate limit is exceeded.
   *
   * Unauthenticated by design: the token itself is the credential. The response
   * deliberately discloses nothing about the account beyond "this link worked".
   */
  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify an email address',
    description:
      'Consumes a single-use verification token and marks the account email as verified. ' +
      'The token is valid for 24 hours and can be used exactly once. ' +
      'Invalid, expired and already-used tokens all return the same 400 response.',
  })
  @ApiOkResponse({
    description: 'Email address verified successfully',
    type: VerifyEmailResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Token is invalid, expired, or has already been used — the response does not distinguish these cases',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many verification attempts — please wait before retrying',
  })
  async verifyEmail(
    @Body() dto: VerifyEmailRequestDto,
  ): Promise<VerifyEmailResponseDto> {
    await this.emailVerificationService.verifyEmail(dto.token);

    const response = new VerifyEmailResponseDto();
    response.verified = true;
    response.message = 'Your email address has been verified.';
    return response;
  }

  /**
   * POST /api/v1/auth/resend-verification
   *
   * Resends a verification email for an address.
   *
   * - Returns 202 Accepted with a constant body for every well-formed request,
   *     whether or not an account exists, is already verified, is within the
   *     60-second resend cooldown, or the mail transport is unavailable.
   * - Returns 400 Bad Request only for a malformed email, which cannot leak
   *     account existence because the caller already knows their input is invalid.
   * - Returns 429 Too Many Requests when the rate limit is exceeded.
   *
   * Enumeration resistance: the uniform 202 is what prevents this endpoint from
   * being used to discover registered addresses. Never vary the body or status
   * on the internal outcome.
   */
  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Resend an email verification message',
    description:
      'Sends a new verification email and invalidates any previous unused token. ' +
      'Enforces a 60-second cooldown between sends per account. ' +
      'Returns the same 202 response whether or not an account exists for the address.',
  })
  @ApiAcceptedResponse({
    description:
      'Request accepted — a verification email is sent if the account exists and needs verification',
    type: ResendVerificationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed — the email address is malformed',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many resend requests — please wait before retrying',
  })
  async resendVerification(
    @Body() dto: ResendVerificationRequestDto,
  ): Promise<ResendVerificationResponseDto> {
    // The outcome is intentionally discarded here: it is logged inside the
    // service and must never influence this response.
    await this.emailVerificationService.resendVerification(dto.email);

    const response = new ResendVerificationResponseDto();
    response.status = HttpStatus.ACCEPTED;
    response.message =
      'If an account exists for that address, a verification email has been sent.';
    return response;
  }

  /**
   * Maps the internal SafeUser domain type to the explicit RegisterResponseDto.
   * Ensures the response contract is explicitly defined and passwordHash cannot
   * accidentally be added to the SafeUser type and leak through here.
   */
  private toResponseDto(user: SafeUser): RegisterResponseDto {
    const dto = new RegisterResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.role = user.role;
    dto.status = user.status;
    dto.emailVerifiedAt = user.emailVerifiedAt;
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.updatedAt;
    return dto;
  }

  /**
   * POST /api/v1/auth/login
   *
   * Authenticates user credentials, creates a PostgreSQL session, and dispatches
   * RS256 JWT access and opaque refresh tokens in HttpOnly cookies.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Authenticate with email and password',
    description:
      'Verifies credentials, checks active and verified account status, creates a session, and sets secure HttpOnly cookies.',
  })
  @ApiOkResponse({
    description: 'Login successful. Secure HttpOnly cookies set.',
    type: LoginResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed — invalid email format or empty password.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials, unverified email, or deactivated account.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many login attempts — please wait before retrying.',
  })
  async login(
    @Body() dto: LoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    return await this.loginService.login(dto, req, res);
  }

  /**
   * POST /api/v1/auth/refresh
   *
   * Refreshes an active session using the opaque refresh cookie and atomically
   * rotates the refresh token.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Refresh access JWT and rotate refresh token',
    description:
      'Authenticates via the academy_refresh HttpOnly cookie, performs atomic token rotation, and updates cookies.',
  })
  @ApiOkResponse({
    description: 'Session refreshed successfully. New cookies set.',
    type: RefreshResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired, or stale refresh token.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponseDto> {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    return await this.loginService.refresh(rawRefreshToken, req, res);
  }

  /**
   * GET /api/v1/auth/me
   *
   * Returns the current authenticated user profile context.
   * Requires a valid access JWT and active database session.
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Get current authenticated user',
    description:
      'Returns safe account details for the authenticated user and active session.',
  })
  @ApiOkResponse({
    description: 'Current user profile.',
    type: CurrentUserResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required, token expired, or session revoked.',
  })
  getCurrentUser(@CurrentUser() user: AuthenticatedUser): CurrentUserResponseDto {
    const dto = new CurrentUserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.role = user.role;
    dto.status = user.status;
    dto.emailVerifiedAt = user.emailVerifiedAt;
    return dto;
  }

  /**
   * POST /api/v1/auth/logout
   *
   * Ends the session on the current device.
   * Works when access JWT is expired or missing, provided the refresh cookie identifies a valid session.
   * Clears both authentication cookies.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Log out current device',
    description:
      'Revokes the current device session identified by access JWT or refresh cookie and clears authentication cookies.',
  })
  @ApiOkResponse({
    description: 'Logged out successfully.',
    type: LogoutResponseDto,
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    return await this.logoutService.logout(req, res);
  }

  /**
   * POST /api/v1/auth/logout-all
   *
   * Revokes all active sessions belonging to the authenticated account across all devices.
   */
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Log out from all devices',
    description:
      'Revokes all active sessions for the current authenticated user and clears current cookies.',
  })
  @ApiOkResponse({
    description: 'All sessions logged out successfully.',
    type: LogoutAllResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required.',
  })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutAllResponseDto> {
    return await this.logoutService.logoutAll(user, res);
  }

  /**
   * GET /api/v1/auth/sessions
   *
   * Returns a safe list of the authenticated user's active device sessions.
   */
  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'List active device sessions',
    description:
      'Returns all active, unrevoked, and unexpired device sessions for the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Active session list.',
    type: [ActiveSessionResponseDto],
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required.',
  })
  async getSessions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ActiveSessionResponseDto[]> {
    return await this.logoutService.getActiveSessions(user);
  }

  /**
   * DELETE /api/v1/auth/sessions/:sessionId
   *
   * Revokes a specific active session belonging to the authenticated user.
   */
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Revoke an active device session',
    description:
      'Revokes a designated active session owned by the authenticated user. Clears cookies if the revoked session is current.',
  })
  @ApiOkResponse({
    description: 'Session revoked successfully.',
    type: RevokeSessionResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid sessionId format — must be a valid UUID v4.',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required.',
  })
  @ApiNotFoundResponse({
    description: 'Session not found, already revoked, or belongs to another user.',
  })
  async revokeSession(
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RevokeSessionResponseDto> {
    return await this.logoutService.revokeSession(sessionId, user, res);
  }
}
