import { Module } from '@nestjs/common';
import { AdminCategoriesController } from './controllers/admin-categories.controller.js';
import { AdminTagsController } from './controllers/admin-tags.controller.js';
import { PublicCategoriesController } from './controllers/public-categories.controller.js';
import { PublicTagsController } from './controllers/public-tags.controller.js';
import { CategoriesService } from './services/categories.service.js';
import { TagsService } from './services/tags.service.js';
import { CategoriesRepository } from './repositories/categories.repository.js';
import { TagsRepository } from './repositories/tags.repository.js';

@Module({
  controllers: [
    AdminCategoriesController,
    AdminTagsController,
    PublicCategoriesController,
    PublicTagsController,
  ],
  providers: [
    CategoriesService,
    TagsService,
    CategoriesRepository,
    TagsRepository,
  ],
  exports: [
    CategoriesService,
    TagsService,
    CategoriesRepository,
    TagsRepository,
  ],
})
export class TaxonomyModule {}

