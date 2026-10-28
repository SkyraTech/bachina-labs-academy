import { ApiProperty } from '@nestjs/swagger';

export class MediaAssetResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the media asset',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Original uploaded filename for author reference',
    example: 'article-cover.webp',
  })
  originalFilename!: string;

  @ApiProperty({
    description: 'MIME type of the media asset',
    example: 'image/webp',
  })
  mimeType!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 245760,
  })
  fileSize!: number;

  @ApiProperty({
    description: 'Media category/type',
    example: 'IMAGE',
  })
  mediaType!: string;

  @ApiProperty({
    description: 'Image pixel width, if recorded',
    example: 1200,
    nullable: true,
  })
  width!: number | null;

  @ApiProperty({
    description: 'Image pixel height, if recorded',
    example: 630,
    nullable: true,
  })
  height!: number | null;

  @ApiProperty({
    description: 'Optional descriptive alternative text',
    example: 'Architecture diagram',
    nullable: true,
  })
  altText!: string | null;

  @ApiProperty({
    description: 'Timestamp when the media asset was uploaded',
    example: '2026-10-26T12:00:00.000Z',
  })
  createdAt!: string;
}
