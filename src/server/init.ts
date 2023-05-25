/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import type { ContentAssets, ModuleAssets } from '@fastly/compute-js-static-publish';
import { initFsAssets } from "./fs";

export type InitParams = {
  contentAssets: ContentAssets,
  moduleAssets: ModuleAssets,
};

export function init(initParams: InitParams) {
  // Init FS assets
  const { contentAssets, moduleAssets } = initParams;
  initFsAssets(contentAssets, moduleAssets)
}
