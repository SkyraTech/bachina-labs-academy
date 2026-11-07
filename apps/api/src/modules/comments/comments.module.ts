import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PublicArticleCommentsController } from './controllers/public-article-comments.controller.js';
import { ArticleCommentsController } from './controllers/article-comments.controller.js';
import { AdminCommentsController } from './controllers/admin-comments.controller.js';
import { ArticleCommentsService } from './services/article-comments.service.js';
import { ModerationCleanupService } from './services/moderation-cleanup.service.js';
import { ArticleCommentsRepository } from './repositories/article-comments.repository.js';

@Module({
  imports: [ConfigModule],
  controllers: [
    PublicArticleCommentsController,
    ArticleCommentsController,
    AdminCommentsController,
  ],
  providers: [
    ArticleCommentsService,
    ModerationCleanupService,
    ArticleCommentsRepository,
  ],
  exports: [
    ArticleCommentsService,
    ModerationCleanupService,
    ArticleCommentsRepository,
  ],
})
export class CommentsModule {}
