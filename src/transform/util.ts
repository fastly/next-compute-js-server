import path from 'path';
import fs from 'fs';
import {
  VcConfigEdge,
} from '@fastly/serve-vercel-build-output';

import {
  VERCEL_FUNCTION_CONFIG_FILENAME,
  VcConfig,
  VcConfigServerless,
} from './constants';

// Map a function's path to its function name route
// eg:
//    /functions/index.func          -> index
//    /functions/foo/bar.func        -> foo/bar
//    /functions/foo/bar/index.func  -> foo/bar/index
export function mapFunctionPathToFunctionName(functionPath: string) {

  if (!functionPath.startsWith('/functions/')) {
    throw new Error(`Function path must start with /functions/, received '${functionPath}'.`);
  }

  let functionName = functionPath.slice('/functions/'.length);

  functionName = functionName.slice(0, functionName.lastIndexOf('.func'));

  return functionName;

}

// Map a function's name to its page route
// eg:
//    index          -> /
//    foo/bar        -> /foo/bar
//    foo/bar/index  -> /foo/bar
//    /foo/bar/index -> /foo/bar
export function mapFunctionNameToPageRoute(functionName: string) {

  let adjustedFunctionName = functionName;

  if (!adjustedFunctionName.startsWith('/')) {
    adjustedFunctionName = '/' + adjustedFunctionName;
  }

  if (adjustedFunctionName === '/index') {
    adjustedFunctionName = '/';
  } else if (adjustedFunctionName.endsWith('/index')) {
    adjustedFunctionName = adjustedFunctionName.slice(0, -('/index'.length));
  }

  return adjustedFunctionName;
}

export function loadVcConfig(functionPath: string): VcConfig | null {

  // Loads the "vercel config file" (.vc-config.json)
  // or, returns null, if it is not any of the known config file types

  const vcConfigFilePath = path.join(functionPath, VERCEL_FUNCTION_CONFIG_FILENAME);

  let vcConfigFile;
  try {
    const vcConfigFileJson = fs.readFileSync(vcConfigFilePath, 'utf-8');
    vcConfigFile = JSON.parse(vcConfigFileJson) as VcConfig;
  } catch(ex) {
    throw new Error('Error loading vercel config file \'' + vcConfigFilePath + '\'.', { cause: ex });
  }

  if (
    vcConfigFile.runtime === 'edge' &&
    vcConfigFile.deploymentTarget === 'v8-worker'
  ) {
    return vcConfigFile as VcConfigEdge;
  }

  if (
    vcConfigFile.runtime.startsWith('nodejs')
  ) {
    return vcConfigFile as VcConfigServerless;
  }

  return null;
}
