import fs from 'fs';
import path from 'path';
import {
  TransformContext,
  VcConfigEdge,
} from '@fastly/serve-vercel-build-output';

import { VERCEL_FUNCTION_CONFIG_FILENAME } from './constants';
import { copyFile } from './file';

export function validateConfig(vcConfig: VcConfigEdge) {
  // no other things to validate
}

export function doTransform(vcConfig: VcConfigEdge, ctx: TransformContext) {

  console.log(`Next.js edge transform STARTING for '${ctx.functionPath}'.`);

  // For edge functions, we only need to directly copy the .vc-config.json
  // and entry point functions.

  // Create the output directory
  fs.mkdirSync(ctx.functionFilesTargetPath, { recursive: true });

  copyFile(
    path.join(ctx.functionFilesSourcePath, VERCEL_FUNCTION_CONFIG_FILENAME),
    path.join(ctx.functionFilesTargetPath, VERCEL_FUNCTION_CONFIG_FILENAME),
    'Function config file'
  );

  copyFile(
    path.join(ctx.functionFilesSourcePath, vcConfig.entrypoint),
    path.join(ctx.functionFilesTargetPath, vcConfig.entrypoint),
    'Function entry point file'
  );

  console.log(`Next.js edge transform COMPLETED for '${ctx.functionPath}'.`);

}
