import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../api/api-client.service';
import {
  ActiveSession,
  CurrentUser,
  LoginRequest,
  LoginResponse,
  LogoutAllResponse,
  LogoutResponse,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  ResendVerificationRequest,
  ResendVerificationResponse,
  RevokeSessionResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
} from '../models';

/**
 * Strongly typed service coordinating HTTP communication with the NestJS Auth API.
 *
 * Security architecture:
 * - Delegates all calls to ApiClientService, which enforces `withCredentials: true`.
 * - Tokens are delivered exclusively via secure HttpOnly cookies (`academy_access`, `academy_refresh`).
 * - Never stores or handles tokens in localStorage, sessionStorage, or JavaScript memory.
 * - Never attaches Authorization Bearer headers.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthApiService {
  private readonly api = inject(ApiClientService);

  /**
   * Registers a new account with email and password.
   * Endpoint: POST /api/v1/auth/register
   */
  register(request: RegisterRequest): Observable<RegisterResponse> {
    return this.api.post<RegisterResponse>('/auth/register', request);
  }

  /**
   * Authenticates user credentials and issues HttpOnly session cookies.
   * Endpoint: POST /api/v1/auth/login
   */
  login(request: LoginRequest): Observable<LoginResponse> {
    return this.api.post<LoginResponse>('/auth/login', request);
  }

  /**
   * Verifies an email address using a single-use token.
   * Endpoint: POST /api/v1/auth/verify-email
   */
  verifyEmail(request: VerifyEmailRequest): Observable<VerifyEmailResponse> {
    return this.api.post<VerifyEmailResponse>('/auth/verify-email', request);
  }

  /**
   * Requests a new email verification message.
   * Endpoint: POST /api/v1/auth/resend-verification
   */
  resendVerification(request: ResendVerificationRequest): Observable<ResendVerificationResponse> {
    return this.api.post<ResendVerificationResponse>('/auth/resend-verification', request);
  }

  /**
   * Retrieves the current authenticated user profile context.
   * Endpoint: GET /api/v1/auth/me
   */
  getCurrentUser(): Observable<CurrentUser> {
    return this.api.get<CurrentUser>('/auth/me');
  }

  /**
   * Refreshes the session using the HttpOnly refresh token cookie and issues a new access token.
   * Endpoint: POST /api/v1/auth/refresh
   */
  refresh(): Observable<RefreshResponse> {
    return this.api.post<RefreshResponse>('/auth/refresh', {});
  }

  /**
   * Ends the current device session and clears HttpOnly session cookies.
   * Endpoint: POST /api/v1/auth/logout
   */
  logout(): Observable<LogoutResponse> {
    return this.api.post<LogoutResponse>('/auth/logout', {});
  }

  /**
   * Revokes all active sessions for the current account across all devices.
   * Endpoint: POST /api/v1/auth/logout-all
   */
  logoutAll(): Observable<LogoutAllResponse> {
    return this.api.post<LogoutAllResponse>('/auth/logout-all', {});
  }

  /**
   * Retrieves active device sessions for the authenticated user.
   * Endpoint: GET /api/v1/auth/sessions
   */
  getSessions(): Observable<ActiveSession[]> {
    return this.api.get<ActiveSession[]>('/auth/sessions');
  }

  /**
   * Revokes a specific session owned by the authenticated user.
   * Endpoint: DELETE /api/v1/auth/sessions/:sessionId
   */
  revokeSession(sessionId: string): Observable<RevokeSessionResponse> {
    return this.api.delete<RevokeSessionResponse>(`/auth/sessions/${sessionId}`);
  }
}
