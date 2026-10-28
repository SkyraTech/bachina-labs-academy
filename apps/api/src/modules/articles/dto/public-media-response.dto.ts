import { ApiProperty } from '@nestjs/swagger';

export class PublicMediaResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the media asset',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'MIME type of the media asset',
    example: 'image/webp',
  })
  mimeType!: string;

  @ApiProperty({
    description: 'Image pixel width, if available',
    example: 1200,
    nullable: true,
  })
  width!: number | null;

  @ApiProperty({
    description: 'Image pixel height, if available',
    example: 630,
    nullable: true,
  })
  height!: number | null;

  @ApiProperty({
    description: 'Descriptive alternative text for accessibility',
    example: 'Illustration of database architecture',
    nullable: true,
  })
  altText!: string | null;

  @ApiProperty({
    description: 'Public media delivery URL (null if delivery service is not configured)',
    example: null,
    nullable: true,
  })
  url!: string | null;
}
