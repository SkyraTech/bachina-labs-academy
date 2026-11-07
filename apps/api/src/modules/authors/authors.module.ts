import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module.js';
import { PublicAuthorsController } from './controllers/public-authors.controller.js';
import { PublicAuthorsService } from './services/public-authors.service.js';
import { PublicAuthorsRepository } from './repositories/public-authors.repository.js';

@Module({
  imports: [ArticlesModule],
  controllers: [PublicAuthorsController],
  providers: [PublicAuthorsService, PublicAuthorsRepository],
  exports: [PublicAuthorsService, PublicAuthorsRepository],
})
export class AuthorsModule {}

