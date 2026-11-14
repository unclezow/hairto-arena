import { Module } from '@nestjs/common';
import { RpcProxyController } from './rpc-proxy.controller.js';
import { RpcProxyService } from './rpc-proxy.service.js';

@Module({ controllers: [RpcProxyController], providers: [RpcProxyService] })
export class RpcProxyModule {}
