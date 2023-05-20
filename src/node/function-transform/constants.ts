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

export const NEXT_VERSION = '13.1.3';
export const COMPATIBLE_NEXT_VERSIONS = [
  '13.1.3',
  '13.1.4',
  '13.1.5',
  '13.1.6',
];
