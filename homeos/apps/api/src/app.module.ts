import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AssistantController } from './assistant/assistant.controller';
import { AssistantService } from './assistant/assistant.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuditService } from './common/audit.service';
import { AuthGuard, HouseholdGuard } from './common/context';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { StorageService } from './documents/storage.service';
import { FinanceController, FinanceService } from './finance/finance.controller';
import { HouseholdsController } from './households/households.controller';
import { HouseholdsService } from './households/households.service';
import { InboxController } from './inbox/inbox.controller';
import { InboxService } from './inbox/inbox.service';
import { InsightsController } from './insights/insights.controller';
import { InsightsService } from './insights/insights.service';
import { JobsService } from './jobs/jobs.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PlatformController } from './platform.controller';
import { PrismaService } from './prisma.service';
import { PrivacyController, PrivacyService } from './privacy/privacy.controller';
import { RESOURCE_CONTROLLERS } from './resources/resource.controller';
import { ResourceService } from './resources/resource.service';
import { StaffController, StaffService } from './staff/staff.controller';

/** Cross-cutting infrastructure shared by every feature module. */
@Global()
@Module({
  providers: [PrismaService, AuditService, ResourceService, StorageService, JobsService, AuthGuard, HouseholdGuard],
  exports: [PrismaService, AuditService, ResourceService, StorageService, JobsService, AuthGuard, HouseholdGuard],
})
export class CoreModule {}

@Module({ controllers: [HouseholdsController], providers: [HouseholdsService], exports: [HouseholdsService] })
export class HouseholdsModule {}

@Module({ imports: [HouseholdsModule], controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}

@Module({ controllers: [DocumentsController], providers: [DocumentsService], exports: [DocumentsService] })
export class DocumentsModule {}

@Module({ imports: [DocumentsModule], controllers: [InboxController], providers: [InboxService] })
export class InboxModule {}

@Module({ controllers: [InsightsController], providers: [InsightsService], exports: [InsightsService] })
export class InsightsModule {}

@Module({ controllers: [FinanceController], providers: [FinanceService] })
export class FinanceModule {}

@Module({ controllers: [StaffController], providers: [StaffService], exports: [StaffService] })
export class StaffModule {}

@Module({ controllers: [PaymentsController], providers: [PaymentsService], exports: [PaymentsService] })
export class PaymentsModule {}

@Module({
  imports: [InsightsModule, StaffModule, PaymentsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

@Module({ imports: [InsightsModule, DocumentsModule], controllers: [AssistantController], providers: [AssistantService] })
export class AssistantModule {}

@Module({ controllers: [PrivacyController], providers: [PrivacyService], exports: [PrivacyService] })
export class PrivacyModule {}

@Module({ imports: [NotificationsModule, PaymentsModule], controllers: [PlatformController] })
export class PlatformModule {}

/** Generic CRUD controllers for every registry resource. Registered last so specific routes win. */
@Module({ controllers: RESOURCE_CONTROLLERS })
export class ResourcesModule {}

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Default limit for every route; auth and assistant routes set tighter limits.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 100_000 : Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300) }]),
    CoreModule,
    AuthModule,
    HouseholdsModule,
    DocumentsModule,
    InboxModule,
    InsightsModule,
    FinanceModule,
    StaffModule,
    PaymentsModule,
    NotificationsModule,
    AssistantModule,
    PrivacyModule,
    PlatformModule,
    ResourcesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
