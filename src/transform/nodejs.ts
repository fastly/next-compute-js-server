import fs from 'fs';
import path from 'path';
import {
  TransformContext,
  VcConfigEdge,
} from '@fastly/serve-vercel-build-output';

import {
  BUILD_ID_FILE,
  SERVER_FILES_MANIFEST,
} from 'next/constants';
import {
  NextConfig,
} from 'next';
import {
  NEXT_VERSION,
  VERCEL_FUNCTION_CONFIG_FILENAME,
  VcConfigServerless,
} from "./constants";
import {
  mapFunctionPathToFunctionName,
} from "./util";

type NextLauncherData = {
  nextRuntimePackage: string,        // will be equal to transformName
  conf: NextConfig,                  // get this by going into DIST_DIR/
  fsRoot: string,                    // this is the directory
};

const DIST_DIR = '.next'; // vercel build always uses .next
const NEXT_LAUNCHER_FILENAME = '___next_launcher.cjs';
const FASTLY_NEXT_LAUNCHER_FILENAME = '___fastly_next_launcher.cjs';
const INIT_SCRIPT_FILENAME = `next-compute-js-server-${NEXT_VERSION}.cjs`;

export function validateConfig(vcConfig: VcConfigServerless) {

  if (vcConfig.handler !== NEXT_LAUNCHER_FILENAME) {
    throw new Error(`.vc-config.json contains unexpected 'launcher' value. Expected '${NEXT_LAUNCHER_FILENAME}', found '${vcConfig.handler ?? '(no value)'}'.`);
  }

}

export function doTransform(vcConfig: VcConfigServerless, ctx: TransformContext) {

  // Create the output directory
  fs.mkdirSync(ctx.functionFilesTargetPath, { recursive: true });

  // Next.js config taken from SERVER_FILES_MANIFEST from project root
  const nextConfig = loadNextConfig(ctx.nextProjectPath);
  const conf = Object.assign({}, nextConfig, { compress: false });

  // Generate and write the fastly launcher script
  const fastlyNextLauncherScript = buildFastlyNextLauncherScript({
    nextRuntimePackage: ctx.transformName,
    fsRoot: ctx.functionPath,
    conf,
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

  // Create a new .vc-config.json file for the transformed function
  const newVcConfig: VcConfigEdge = {
    runtime: 'edge',
    deploymentTarget: 'v8-worker',
    name: mapFunctionPathToFunctionName(ctx.functionPath),
    entrypoint: FASTLY_NEXT_LAUNCHER_FILENAME,
    framework: {
      slug: 'nextjs',
      version: NEXT_VERSION,
    },
  };

  fs.writeFileSync(
    path.join(ctx.functionFilesTargetPath, VERCEL_FUNCTION_CONFIG_FILENAME),
    JSON.stringify(newVcConfig, undefined, 2),
    'utf-8'
  );

  // Create /init/ script. This needs to happen only once regardless of the number of
  // times this plugin runs.
  const initScriptPath = path.join(ctx.buildOutputPath, 'init', INIT_SCRIPT_FILENAME);

  if (!fs.existsSync(initScriptPath)) {

    const initScript = buildInitScript(ctx.transformName);
    fs.mkdirSync(path.dirname(initScriptPath), { recursive: true });
    fs.writeFileSync(
      initScriptPath,
      initScript,
      'utf-8'
    );

  }
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

function buildFastlyNextLauncherScript(data: NextLauncherData) {

  return `
    const { default: NextComputeJsServer, initFs } = require(${JSON.stringify(data.nextRuntimePackage)});
    
    const conf = ${JSON.stringify(data.conf)};
    const fsRoot = ${JSON.stringify(data.fsRoot)};
    
    initFs(fsRoot);
    
    const nextServer = new NextComputeJsServer({
      conf,
      computeJsConfig: {
        extendRenderOpts: {
          runtime: "experimental-edge",
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

function buildInitScript(nextRuntimePackage: string) {
  return `
    module.exports = function({contentAssets, moduleAssets}) {
      const { initFsAssets } = require(${JSON.stringify(nextRuntimePackage)});
      initFsAssets(contentAssets, moduleAssets);
    };
  `;
}
