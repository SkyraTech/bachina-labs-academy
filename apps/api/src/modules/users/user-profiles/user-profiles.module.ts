import { Module } from '@nestjs/common';
import { UserProfilesController } from './controllers/user-profiles.controller.js';
import { UserProfilesService } from './services/user-profiles.service.js';
import { UserProfilesRepository } from './repositories/user-profiles.repository.js';

@Module({
  controllers: [UserProfilesController],
  providers: [UserProfilesService, UserProfilesRepository],
  exports: [UserProfilesService, UserProfilesRepository],
})
export class UserProfilesModule {}

