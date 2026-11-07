import { ApiProperty } from '@nestjs/swagger';
import { CommentStatus, ModerationReason } from '@prisma/client';

export class AdminCommentResponseDto {
  @ApiProperty({ description: 'Comment UUID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ description: 'Article UUID' })
  articleId!: string;

  @ApiProperty({ description: 'Article published slug' })
  articleSlug!: string;

  @ApiProperty({ description: 'Article title' })
  articleTitle!: string;

  @ApiProperty({ description: 'Snapshot UUID' })
  snapshotId!: string;

  @ApiProperty({ description: 'Snapshot revision number' })
  snapshotRevision!: number;

  @ApiProperty({ description: 'Author user UUID' })
  userId!: string;

  @ApiProperty({ description: 'Author display name' })
  authorDisplayName!: string;

  @ApiProperty({ description: 'Comment body (redacted to empty string if removed > 30 days)' })
  body!: string;

  @ApiProperty({ description: 'Comment status', enum: CommentStatus })
  status!: CommentStatus;

  @ApiProperty({ description: 'Removal timestamp if removed', nullable: true })
  removedAt!: string | null;

  @ApiProperty({ description: 'Admin user UUID who removed comment', nullable: true })
  removedByUserId!: string | null;

  @ApiProperty({ description: 'Moderation reason enum', enum: ModerationReason, nullable: true })
  removalReason!: ModerationReason | null;

  @ApiProperty({ description: 'Whether the body is redacted due to 30-day retention window expiration' })
  isRetentionExpired!: boolean;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'Update timestamp' })
  updatedAt!: string;
}

export class PaginatedAdminCommentsResponseDto {
  @ApiProperty({ type: [AdminCommentResponseDto] })
  items!: AdminCommentResponseDto[];

  @ApiProperty({
    example: {
      page: 1,
      limit: 20,
      total: 10,
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

