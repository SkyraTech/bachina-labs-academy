export interface UserProfileResponse {
  id: string | null;
  userId: string;
  displayName: string;
  isFallback: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpdateUserProfileRequest {
  displayName: string;
}

