import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';

/**
 * AuditModule — provides durable database audit logging infrastructure.
 *
 * Exports AuditService and AuditRepository for consumption by application domain modules.
 * Deliberately excludes controllers and public endpoints.
 */
@Module({
  imports: [DatabaseModule],
  providers: [AuditRepository, AuditService],
  exports: [AuditService, AuditRepository],
})
export class AuditModule {}
