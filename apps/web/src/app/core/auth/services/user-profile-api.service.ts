import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '../../api/api-client.service';
import type { UpdateUserProfileRequest, UserProfileResponse } from '../models/user-profile.model';

/**
 * Service coordinating HTTP communication with the UserProfile API.
 * Communicates with /api/v1/account/profile.
 */
@Injectable({
  providedIn: 'root',
})
export class UserProfileApiService {
  private readonly api = inject(ApiClientService);

  getProfile(): Observable<UserProfileResponse> {
    return this.api.get<UserProfileResponse>('/account/profile');
  }

  updateProfile(request: UpdateUserProfileRequest): Observable<UserProfileResponse> {
    return this.api.put<UserProfileResponse>('/account/profile', request);
  }
}

