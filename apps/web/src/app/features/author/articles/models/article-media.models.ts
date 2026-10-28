export interface MediaAssetDto {
  id: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  mediaType: 'IMAGE';
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface PaginatedMediaAssetsResponse {
  items: MediaAssetDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
