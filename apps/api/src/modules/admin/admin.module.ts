import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AdminOverviewController } from './controllers/admin-overview.controller.js';
import { AdminUsersController } from './controllers/admin-users.controller.js';
import { AdminArticlesController } from './controllers/admin-articles.controller.js';
import { AdminOverviewService } from './services/admin-overview.service.js';
import { AdminUsersService } from './services/admin-users.service.js';
import { AdminArticlesService } from './services/admin-articles.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [
    AdminOverviewController,
    AdminUsersController,
    AdminArticlesController,
  ],
  providers: [
    AdminOverviewService,
    AdminUsersService,
    AdminArticlesService,
  ],
  exports: [
    AdminOverviewService,
    AdminUsersService,
    AdminArticlesService,
  ],
})
export class AdminModule {}

