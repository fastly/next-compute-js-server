/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/// <reference types='@fastly/js-compute' />

import NextComputeJsServer from './server/next-compute-js-server';
import { initFsAssets, initFs, getFsSettings } from './server/fs';

export {
  initFs,
  initFsAssets,
  getFsSettings,
  NextComputeJsServer,
};

export default NextComputeJsServer;
