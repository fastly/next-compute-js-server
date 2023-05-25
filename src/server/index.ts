/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/// <reference types='@fastly/js-compute' />

import NextComputeJsServer from './next-compute-js-server';
import { initFsAssets, initFs, getFsSettings } from './fs';
import { init } from './init';

export {
  init,
  initFs,
  initFsAssets,
  getFsSettings,
  NextComputeJsServer,
};

export default NextComputeJsServer;
