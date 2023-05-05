import {
  TransformContext,
  VcConfigEdge,
} from '@fastly/serve-vercel-build-output';
import fs from "fs";
import path from "path";
import {VERCEL_FUNCTION_CONFIG_FILENAME} from "./constants";

export function validateConfig(vcConfig: VcConfigEdge) {
  // no other things to validate
}

export function doTransform(vcConfig: VcConfigEdge, ctx: TransformContext) {
  // For edge functions, we only need to directly copy the .vc-config.json
  // and entry point functions.

  // Create the output directory
  fs.mkdirSync(ctx.functionFilesTargetPath, { recursive: true });

  fs.cpSync(
    path.join(ctx.functionFilesSourcePath, VERCEL_FUNCTION_CONFIG_FILENAME),
    path.join(ctx.functionFilesTargetPath, VERCEL_FUNCTION_CONFIG_FILENAME)
  );

  fs.cpSync(
    path.join(ctx.functionFilesSourcePath, vcConfig.entrypoint),
    path.join(ctx.functionFilesTargetPath, vcConfig.entrypoint)
  );

}
