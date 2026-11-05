import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard, RolesGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, AuthGuard, RolesGuard],
  exports: [SessionService, AuthGuard, RolesGuard],
})
export class AuthModule {}
