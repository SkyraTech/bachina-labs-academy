import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ArticlePublicReaderController } from './controllers/article-public-reader.controller.js';
import { ArticleMediaController } from './controllers/article-media.controller.js';
import { ArticlesController } from './controllers/articles.controller.js';
import { ArticleBlocksController } from './controllers/article-blocks.controller.js';
import { ArticlePublicationController } from './controllers/article-publication.controller.js';
import { ArticlePublicReaderService } from './services/article-public-reader.service.js';
import { ArticleMediaService } from './services/article-media.service.js';
import { ArticleMediaStorageService } from './services/article-media-storage.service.js';
import { ArticlesService } from './services/articles.service.js';
import { ArticleBlocksService } from './services/article-blocks.service.js';
import { ArticlePublicationService } from './services/article-publication.service.js';
import { ArticlePublicReaderRepository } from './repositories/article-public-reader.repository.js';
import { ArticleMediaRepository } from './repositories/article-media.repository.js';
import { ArticlesRepository } from './repositories/articles.repository.js';
import { ArticleBlocksRepository } from './repositories/article-blocks.repository.js';
import { ArticlePublicationRepository } from './repositories/article-publication.repository.js';

@Module({
  imports: [AuthModule],
  controllers: [
    ArticlePublicReaderController,
    ArticleMediaController,
    ArticlesController,
    ArticleBlocksController,
    ArticlePublicationController,
  ],
  providers: [
    ArticlePublicReaderService,
    ArticlePublicReaderRepository,
    ArticleMediaService,
    ArticleMediaStorageService,
    ArticleMediaRepository,
    ArticlesService,
    ArticlesRepository,
    ArticleBlocksService,
    ArticleBlocksRepository,
    ArticlePublicationService,
    ArticlePublicationRepository,
  ],
  exports: [
    ArticlePublicReaderService,
    ArticlePublicReaderRepository,
    ArticleMediaService,
    ArticleMediaStorageService,
    ArticleMediaRepository,
    ArticlesService,
    ArticlesRepository,
    ArticleBlocksService,
    ArticleBlocksRepository,
    ArticlePublicationService,
    ArticlePublicationRepository,
  ],
})
export class ArticlesModule {}
