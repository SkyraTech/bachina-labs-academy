import { ApiProperty } from '@nestjs/swagger';

export class PublicCommentResponseDto {
  @ApiProperty({ description: 'Comment UUID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ description: 'Public published article slug', example: 'understanding-immutable-snapshots' })
  articleSlug!: string;

  @ApiProperty({ description: 'Snapshot revision provenance', example: 1 })
  snapshotRevision!: number;

  @ApiProperty({ description: 'Attributed author display name', example: 'Jane Doe' })
  authorDisplayName!: string;

  @ApiProperty({ description: 'Whether the commenter is the article author', example: false })
  isArticleAuthor!: boolean;

  @ApiProperty({ description: 'Plain text comment body', example: 'Great article!' })
  body!: string;

  @ApiProperty({ description: 'Creation timestamp', example: '2026-11-06T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp', example: '2026-11-06T00:00:00.000Z' })
  updatedAt!: string;
}

export class PaginatedPublicCommentsResponseDto {
  @ApiProperty({ type: [PublicCommentResponseDto] })
  items!: PublicCommentResponseDto[];

  @ApiProperty({
    example: {
      page: 1,
      limit: 20,
      total: 5,
      totalPages: 1,
    },
  })
  meta!: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

