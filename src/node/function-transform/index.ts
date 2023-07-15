/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as fs from 'fs';
import {
  COMPATIBLE_NEXT_VERSIONS,
  VcConfigServerless,
} from './constants';
import {
  loadVcConfig,
} from "./util";

import * as nodejs from './nodejs';
import * as edge from './edge';

import type {
  TransformContext,
  VcConfigEdge,
} from '@fastly/serve-vercel-build-output';

async function transformFunction(
  ctx: TransformContext
) {

  const vcConfig = loadVcConfig(ctx.functionFilesSourcePath);

  let functionSkipReason: string | null = null;

  let runtime: 'edge' | 'nodejs' | null = null;

  if (fs.existsSync(ctx.functionFilesTargetPath)) {
    functionSkipReason = `target directory '${ctx.functionFilesTargetPath}' already exists.`;
  } else if (vcConfig == null) {
    functionSkipReason = 'unrecognized .vc-config.json.';
  } else if (vcConfig.runtime == null) {
    functionSkipReason = `.vc-config.json contains no 'runtime' value.`;
  } else if (vcConfig.framework == null) {
    functionSkipReason = `.vc-config.json contains no 'framework' value.`;
  } else if (vcConfig.framework.slug !== 'nextjs') {
    functionSkipReason = `.vc-config.json specifies 'framework.slug' other than 'nextjs': ${vcConfig.framework.slug}.`;
  } else if (!COMPATIBLE_NEXT_VERSIONS.includes(vcConfig.framework.version)) {
    functionSkipReason = `.vc-config.json specifies incompatible Next.js version. Expected ${COMPATIBLE_NEXT_VERSIONS.length > 0 ? 'one of ' : ''}${COMPATIBLE_NEXT_VERSIONS.map(v => `'${v}'`).join(', ')}, found '${vcConfig.framework.version}'.`;
  } else {

    try {
      if (vcConfig.runtime === 'edge') {
        runtime = 'edge';
        edge.validateConfig(vcConfig);
      } else if (vcConfig.runtime.startsWith('nodejs')) {
        runtime = 'nodejs';
        nodejs.validateConfig(vcConfig);
      } else {
        functionSkipReason = `.vc-config.json specifies 'runtime' value other than 'edge' and 'nodejsX.XX': '${vcConfig.runtime}'.`;
      }
    } catch(ex) {
      if (ex instanceof Error) {
        functionSkipReason = ex.message;
      } else {
        throw ex;
      }
    }
  }
  if (functionSkipReason != null) {
    console.debug(`${ctx.transformName} transform: Not performing transform on '${ctx.functionPath}' - ${functionSkipReason}`);
    return false;
  }

  if (runtime === 'edge') {
    edge.doTransform(vcConfig as VcConfigEdge, ctx);
    return true;
  } else if (runtime === 'nodejs') {
    nodejs.doTransform(vcConfig as VcConfigServerless, ctx);
    return true;
  }

  return false;
}

transformFunction.transformType = 'transformFunction';
transformFunction.priority = 10;

export default transformFunction;
