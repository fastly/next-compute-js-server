/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import type {
  VcConfigEdge,
  VcFrameworkDef,
} from "@fastly/serve-vercel-build-output";

export type VcConfigServerless = {
  runtime: `nodejs${string}`,
  handler: string,
  operationType?: string,
  environment?: Record<string, string>,
  supportsMultiPayloads?: boolean,
  framework?: VcFrameworkDef,
  launcherType?: string,
  shouldAddHelpers?: boolean,
  shouldAddSourcemapSupport?: boolean,
};

export type VcConfig =
  | VcConfigEdge
  | VcConfigServerless;

export const VERCEL_FUNCTION_CONFIG_FILENAME = '.vc-config.json';

export const NEXT_VERSION = '12.3.0';
export const COMPATIBLE_NEXT_VERSIONS = [
  '12.3.0'
];
