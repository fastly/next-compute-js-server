/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import type { Options } from 'next/dist/server/base-server';
import type { ContentAssets, ModuleAssets } from "@fastly/compute-js-static-publish";

export type Backend = string | { url: string }; // if string is provided, it is assumed to be url
export type Backends = Record<string, Backend>;

export interface ComputeJsOptions {
  contentAssets: ContentAssets;
  moduleAssets: ModuleAssets;
  backends?: Backends;
}

export interface ComputeJsServerOptions extends Options {
  computeJs: ComputeJsOptions;
}
