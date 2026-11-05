import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './auth.guard.js';

function context(role: 'user' | 'admin'): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: { accountId: 'a.testnet', role } }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: () => ['admin'] } as unknown as Reflector;

  it('rejects a signed-in account that is not on ADMIN_ACCOUNTS with 403', () => {
    const guard = new RolesGuard(reflector);
    try {
      guard.canActivate(context('user'));
      expect.unreachable();
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(403);
    }
  });

  it('lets an admin through', () => {
    expect(new RolesGuard(reflector).canActivate(context('admin'))).toBe(true);
  });
});
