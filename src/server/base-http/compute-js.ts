/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { NodeNextRequest, NodeNextResponse } from 'next/dist/server/base-http/node';

import type { IncomingMessage } from 'http';

export class ComputeJsNextRequest extends NodeNextRequest {
  constructor(req: IncomingMessage, public client: ClientInfo) {
    super(req);
  }
}
export class ComputeJsNextResponse extends NodeNextResponse {
  // Whether to handle compression for this response
  compress?: boolean;
}
