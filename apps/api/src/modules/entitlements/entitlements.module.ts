import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ArticleAccessPolicyRepository } from './repositories/article-access-policy.repository.js';
import { ArticleAccessPolicyService } from './services/article-access-policy.service.js';
import { EntitlementGrantRepository } from './repositories/entitlement-grant.repository.js';
import { EntitlementGrantService } from './services/entitlement-grant.service.js';
import { AccessDecisionService } from './services/access-decision.service.js';

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [
    ArticleAccessPolicyRepository,
    ArticleAccessPolicyService,
    EntitlementGrantRepository,
    EntitlementGrantService,
    AccessDecisionService,
  ],
  exports: [
    ArticleAccessPolicyService,
    EntitlementGrantService,
    AccessDecisionService,
  ],
})
export class EntitlementsModule {}
