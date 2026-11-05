import { Module } from '@nestjs/common';
import { AuditService } from '../admin/audit.service.js';
import { AbuseConfig } from './abuse-config.js';
import { AbuseController } from './abuse.controller.js';
import { AbuseFlagsService } from './abuse-flags.service.js';
import { AbuseJob } from './abuse-job.service.js';
import { AbuseReportService } from './abuse-report.service.js';

/** Flags, review and reports: used by the API (admin routes) and by the keeper (report before posting). */
@Module({
  controllers: [AbuseController],
  providers: [AbuseConfig, AuditService, AbuseFlagsService, AbuseReportService],
  exports: [AbuseConfig, AuditService, AbuseFlagsService, AbuseReportService],
})
export class AbuseModule {}

/** The periodic detection job: runs in the worker only. */
@Module({
  imports: [AbuseModule],
  providers: [AbuseJob],
})
export class AbuseJobModule {}
