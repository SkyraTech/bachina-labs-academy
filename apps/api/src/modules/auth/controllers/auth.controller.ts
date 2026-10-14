import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { RegistrationService } from '../services/registration.service.js';
import { RegisterRequestDto } from '../dto/register-request.dto.js';
import { RegisterResponseDto } from '../dto/register-response.dto.js';
import type { SafeUser } from '../../users/types/index.js';

/**
 * AuthController — REST transport layer for authentication workflows.
 *
 * Responsibilities:
 *   - Accept HTTP requests, delegate to application services, return HTTP responses.
 *   - Apply Swagger documentation decorators.
 *   - NEVER contain business logic, database access or password operations.
 *
 * Route prefix: /api/v1/auth (set via global prefix + controller prefix)
 *
 * Rate limiting:
 *   Applied at the AppModule level via ThrottlerModule. The default throttle
 *   applies to all routes including this controller. Registration does not
 *   require a stricter per-controller override at this phase.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly registrationService: RegistrationService) {}

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
   * is issued. Email verification is handled in Step 2.2.3.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Creates a new email/password account with the AUTHOR role. ' +
      'Does not issue a session or access token. ' +
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
}
