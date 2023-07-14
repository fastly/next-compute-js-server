/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import type { ContentAssets, ModuleAssets } from '@fastly/compute-js-static-publish';

let _fsAssets: {
  contentAssets: ContentAssets,
  moduleAssets: ModuleAssets,
} | null = null;

let _fsSettings: {
  dir: string,
} | null = null;

export function initFsAssets(
  contentAssets: ContentAssets,
  moduleAssets: ModuleAssets,
) {
  _fsAssets = {
    contentAssets,
    moduleAssets,
  };
}

export function initFs(
  dir: string,
) {
  _fsSettings = {
    dir,
  };
}

export function getFsSettings() {
  if (_fsSettings == null) {
    throw new Error('getFsSettings called, but initFs has not been called!');
  }
  if (_fsAssets == null) {
    throw new Error('getFsSettings called, but initFsAssets has not been called!');
  }
  return {
    ..._fsSettings,
    ..._fsAssets,
  };
}
