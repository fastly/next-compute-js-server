import * as path from 'path';
import * as fs from 'fs';
import type { NextConfig } from 'next';
import {
  BUILD_ID_FILE,
  SERVER_FILES_MANIFEST,
} from 'next/constants';

const DIST_DIR = '.next'; // vercel build always uses .next
const NEXT_VERSION = '12.3.0';
const NEXT_LAUNCHER_FILENAME = '___next_launcher.cjs';

const FASTLY_NEXT_LAUNCHER_FILENAME = '___fastly_next_launcher.cjs';

type NextLauncherData = {
  nextRuntimePackage: string,        // will be equal to transformName
  conf: NextConfig,                  // get this by going into DIST_DIR/
  fsRoot: string,                    // this is the directory
  buildId: string,                   // get this by going into DIST_DIR/BUILD_ID
};

type TransformContext = {
  transformName: string,             // package name of the transform
  functionPath: string,              // relative function path (relative to vercel output dir)
  functionFilesSourcePath: string,   // full local path to original copy of function files
  functionFilesTargetPath: string,   // full local path to default target copy of function files
  nextProjectPath: string,           // full local path to project files
  buildOutputPath: string,           // full local path to build output path
};

type VcFrameworkDef = {
  slug: string,
  version: string,
};

type VcConfigEdge = {
  runtime: 'edge',
  deploymentTarget: 'v8-worker',
  name: string,
  entrypoint: string,
  envVarsInUse?: string[],
  assets?: string[],
  framework?: VcFrameworkDef,
};

type VcConfigServerless = {
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

type VcConfig =
  | VcConfigEdge
  | VcConfigServerless;

async function transformFunction(
  ctx: TransformContext
) {

  const vcConfig = loadVcConfig(ctx.functionFilesSourcePath);

  let functionSkipReason: string | null = null;

  if (fs.existsSync(ctx.functionFilesTargetPath)) {
    functionSkipReason = `Target directory '${ctx.functionFilesTargetPath}' already exists.`;
  } else if (vcConfig == null) {
    functionSkipReason = 'Unrecognized .vc-config.json.';
  } else if (vcConfig.runtime === 'edge') {
    functionSkipReason = 'Skipping edge function.';
  } else if (!vcConfig.runtime.startsWith('nodejs')) {
    functionSkipReason = 'Skipping non-nodejs function.';
  } else {
    let nextSkipReason: string | null = null;
    if (vcConfig.handler !== NEXT_LAUNCHER_FILENAME) {
      nextSkipReason = `Next Launcher '${NEXT_LAUNCHER_FILENAME}' missing.`;
    } else {
      if (vcConfig.framework == null ||
        vcConfig.framework.slug !== 'nextjs' ||
        vcConfig.framework.version !== NEXT_VERSION
      ) {
        nextSkipReason = `Unmatched Next versions.`;
      }
    }
    if (nextSkipReason != null) {
      functionSkipReason = `Skipping: ${nextSkipReason}`;
    }
  }
  if (functionSkipReason != null) {
    console.debug(`${ctx.transformName} transform: Skipping '${ctx.functionPath}'`);
    console.debug(functionSkipReason);
    return;
  }

  // Create the output directory
  fs.mkdirSync(ctx.functionFilesTargetPath, { recursive: true });

  // BUILD_ID in the function's directory
  const buildId = loadBuildId(ctx.functionFilesSourcePath);

  // Next.js config taken from SERVER_FILES_MANIFEST from project root
  const nextConfig = loadNextConfig(ctx.nextProjectPath);

  // Generate and write the fastly launcher script
  const fastlyNextLauncherScript = buildFastlyNextLauncherScript({
    nextRuntimePackage: ctx.transformName,
    fsRoot: ctx.functionPath,
    conf: nextConfig,
    buildId,
  });

  fs.writeFileSync(
    path.join(ctx.functionFilesTargetPath, FASTLY_NEXT_LAUNCHER_FILENAME),
    fastlyNextLauncherScript,
    'utf-8'
  );

  // Copy next build output files between .next directories
  fs.cpSync(
    path.join(ctx.functionFilesSourcePath, DIST_DIR),
    path.join(ctx.functionFilesTargetPath, DIST_DIR),
    { recursive: true, }
  );

}

transformFunction.transformType = 'transformFunction';

transformFunction.priority = 10;

export default transformFunction;

function mapFunctionPathToPageRoute(functionPath: string) {

  // Map the function's path to a page route
  // eg:
  //    /functions/index.func          -> /
  //    /functions/foo/bar.func        -> /foo/bar
  //    /functions/foo/bar/index.func  -> /foo/bar
  let adjustedPathname = functionPath
    .slice('/functions/'.length);
  adjustedPathname = adjustedPathname.slice(0, adjustedPathname.lastIndexOf('.func'));

  if (adjustedPathname === 'index') {
    adjustedPathname = '/';
  } else if (adjustedPathname.endsWith('/index')) {
    adjustedPathname = adjustedPathname.slice(0, -('/index'.length));
  }

  return adjustedPathname;
}

function loadVcConfig(functionPath: string): VcConfig | null {

  // Loads the "vercel config file" (.vc-config.json)
  // or, returns null, if it is not any of the known config file types

  const vcConfigFilePath = path.join(functionPath, '.vc-config.json');

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

function loadBuildId(projectPath: string) {

  const nextDirectory = path.join(projectPath, DIST_DIR);

  const buildIdFilePath = path.join(nextDirectory, BUILD_ID_FILE);

  let buildIdFileContent;
  try {
    buildIdFileContent = fs.readFileSync(buildIdFilePath, 'utf-8').trim();
  } catch(ex) {
    throw new Error(`Error loading build ID file \`${buildIdFileContent}'.`, { cause: ex });
  }

  if (buildIdFileContent === '') {
    throw new Error(`Build ID file \`${buildIdFileContent}' is empty.`);
  }

  return buildIdFileContent;
}

function loadNextConfig(projectPath: string) {

  const nextDirectory = path.join(projectPath, DIST_DIR);

  const serverFilesManifestPath = path.join(nextDirectory, SERVER_FILES_MANIFEST);

  let serverFilesManifest;
  try {
    const serverFilesManifestJson = fs.readFileSync(serverFilesManifestPath, 'utf-8');
    serverFilesManifest = JSON.parse(serverFilesManifestJson);
  } catch(ex) {
    throw new Error(`Error loading server files manifest file \`${serverFilesManifestPath}'.`, { cause: ex });
  }

  if (serverFilesManifest.version !== 1 || serverFilesManifest.config == null) {
    throw new Error(`Server files manifest file \`${serverFilesManifestPath}' missing or invalid`);
  }

  // If the JSON was successfully read, we assume it's in that format.
  return serverFilesManifest.config as NextConfig;

}

function buildFastlyNextLauncherScript(ctx: NextLauncherData) {

  const page = mapFunctionPathToPageRoute(ctx.fsRoot);

  return `
    const { default: NextComputeJsServer, initFs } = require(${JSON.stringify(ctx.nextRuntimePackage)};
    
    const conf = ${JSON.stringify(ctx.conf)};
    const fsRoot = ${JSON.stringify(ctx.fsRoot)};
    const page = ${JSON.stringify(page)};
    const buildId = ${JSON.stringify(ctx.buildId)};
    
    initFs(fsRoot);
    
    const nextServer = new NextComputeJsServer({
      conf,
      computeJsConfig: {
        page,
        extendRenderOpts: {
          runtime: "experimental-edge",
          buildId,
        },
      },
      minimalMode: true,
      customServer: false,
    });
    const handler = nextServer.getComputeJsRequestHandler();

    module.exports = async (request, context) => {
      return await handler(request);
    };
  `;
}
