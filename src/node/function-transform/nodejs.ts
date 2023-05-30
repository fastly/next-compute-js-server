import fs from 'fs';
import path from 'path';
import {
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
import { copyFiles, writeFile } from './file';

import type {
  TransformContext,
  VcConfigEdge,
} from '@fastly/serve-vercel-build-output';

type NextLauncherData = {
  nextRuntimePackage: string,        // will be equal to transformName
  conf: NextConfig,                  // get this by going into DIST_DIR/
};

const DIST_DIR = '.next'; // vercel build always uses .next
const NEXT_LAUNCHER_FILENAME = '___next_launcher.cjs';
const FASTLY_NEXT_LAUNCHER_FILENAME = '___fastly_next_launcher.cjs';
const INIT_SCRIPT_FILENAME = `next-compute-js-server-${NEXT_VERSION}.cjs`;
const NEXT_FILES_ROOT_DEST = `/lib/next-${NEXT_VERSION}`;

export function validateConfig(vcConfig: VcConfigServerless) {

  if (vcConfig.handler !== NEXT_LAUNCHER_FILENAME) {
    throw new Error(`.vc-config.json contains unexpected 'launcher' value. Expected '${NEXT_LAUNCHER_FILENAME}', found '${vcConfig.handler ?? '(no value)'}'.`);
  }

}

export function doTransform(vcConfig: VcConfigServerless, ctx: TransformContext) {

  // Create /lib/ directory if it doesn't already exist
  const libDir = path.join(ctx.buildOutputPath, 'lib');
  if (!fs.existsSync(libDir)) {
    fs.mkdirSync(libDir, {recursive: true});
  }

  // Copy /lib/next-NEXT_VERSION/.next files.  This needs to happen only once regardless of the
  // number of times this plugin runs.
  const nextRootDest = path.join(ctx.buildOutputPath, NEXT_FILES_ROOT_DEST);
  if (!fs.existsSync(nextRootDest)) {
    const srcDir = path.join(ctx.nextProjectPath, DIST_DIR);
    copyFiles(
      srcDir,
      path.join(nextRootDest, DIST_DIR),
      `'${DIST_DIR}' files`,
      (src) => {
        if (
          src.endsWith('.js.map') ||
          src.endsWith('.nft.json') ||
          src.startsWith(path.join(srcDir, 'cache')) ||
          src.startsWith(path.join(srcDir, 'static')) ||
          src.startsWith(path.join(srcDir, 'trace'))
        ) {
          console.log(`Skipping ${src}`);
          return false;
        }
        return true;
      }
    );
  }

  // Create /init/ script. This needs to happen only once regardless of the number of
  // times this plugin runs.
  const initScriptPath = path.join(ctx.buildOutputPath, 'init', INIT_SCRIPT_FILENAME);

  if (!fs.existsSync(initScriptPath)) {
    fs.mkdirSync(path.dirname(initScriptPath), { recursive: true });

    const initScript = buildInitScript(ctx.transformName);
    writeFile(
      initScriptPath,
      initScript,
      'Plugin Init script'
    );
  }

  console.log(`Next.js nodejs transform STARTING for '${ctx.functionPath}'.`);

  // Create the output directory
  fs.mkdirSync(ctx.functionFilesTargetPath, { recursive: true });

  // Next.js config taken from SERVER_FILES_MANIFEST from project root
  const nextConfig = loadNextConfig(ctx.nextProjectPath);
  const conf = Object.assign({}, nextConfig, { compress: false });

  // Generate and write the fastly launcher script
  const fastlyNextLauncherScript = buildFastlyNextLauncherScript({
    nextRuntimePackage: ctx.transformName,
    conf,
  });

  writeFile(
    path.join(ctx.functionFilesTargetPath, FASTLY_NEXT_LAUNCHER_FILENAME),
    fastlyNextLauncherScript,
    'Fastly Next.js Launcher'
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

  writeFile(
    path.join(ctx.functionFilesTargetPath, VERCEL_FUNCTION_CONFIG_FILENAME),
    JSON.stringify(newVcConfig, undefined, 2),
    'Function Config file'
  );

  console.log(`Next.js nodejs transform COMPLETED for '${ctx.functionPath}'.`);

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
    
    initFs("${path.join(NEXT_FILES_ROOT_DEST)}");
    
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
      const { init } = require(${JSON.stringify(nextRuntimePackage)});
      init({contentAssets, moduleAssets});
    };
  `;
}
