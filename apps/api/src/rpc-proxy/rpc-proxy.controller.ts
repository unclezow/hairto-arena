import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { RpcProxyService } from './rpc-proxy.service.js';

@Controller('rpc')
@RateLimit('rpc')
export class RpcProxyController {
  constructor(private readonly proxy: RpcProxyService) {}

  /** A JSON-RPC call (or a batch) for the NEAR network, answered by the provider behind this API. */
  @Post()
  @HttpCode(200)
  forward(@Body() body: unknown) {
    return this.proxy.forward(body);
  }
}
