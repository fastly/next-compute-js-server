/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 *
 * Portions of this file Copyright Vercel, Inc., licensed under the MIT license. See LICENSE file for details.
 */

import { join } from 'path';

import { BUILD_MANIFEST, FLIGHT_MANIFEST, REACT_LOADABLE_MANIFEST } from 'next/constants';
import { interopDefault } from 'next/dist/lib/interop-default';
import { requireManifest, requirePage } from './require';

import type { LoadComponentsReturnType } from 'next/dist/server/load-components';

/**
 * Loads React component associated with a given pathname.
 * (An adaptation for Compute@Edge of function in Next.js of the same name,
 * found at next/server/load-components.ts)
 *
 * Differences:
 *  * serverless is not supported
 *  * use
 */
export async function loadComponents(
  distDir: string,
  pathname: string,
  serverless: boolean,
  hasServerComponents: boolean,
  isAppPath: boolean
): Promise<LoadComponentsReturnType> {
  if (serverless) {
    throw new Error("serverless not supported for this platform!");
  }

  let DocumentMod = {};
  let AppMod = {};
  if (!isAppPath) {
    [DocumentMod, AppMod] = await Promise.all([
      Promise.resolve().then(() =>
        requirePage('/_document', distDir, serverless, false)
      ),
      Promise.resolve().then(() =>
        requirePage('/_app', distDir, serverless, false)
      ),
    ]);
  }

  const ComponentMod = await Promise.resolve().then(() =>
    requirePage(pathname, distDir, serverless, isAppPath)
  );

  const [buildManifest, reactLoadableManifest, serverComponentManifest] = await Promise.all([
    requireManifest(join(distDir, BUILD_MANIFEST)),
    requireManifest(join(distDir, REACT_LOADABLE_MANIFEST)),
    hasServerComponents
      ? requireManifest(join(distDir, 'server', FLIGHT_MANIFEST + '.json'))
      : null,
  ]);

  const Component = interopDefault(ComponentMod);
  const Document = interopDefault(DocumentMod);
  const App = interopDefault(AppMod);

  const { getServerSideProps, getStaticProps, getStaticPaths } = ComponentMod;

  return {
    App,
    Document,
    Component,
    buildManifest,
    reactLoadableManifest,
    pageConfig: ComponentMod.config || {},
    ComponentMod,
    getServerSideProps,
    getStaticProps,
    getStaticPaths,
    serverComponentManifest,
    isAppPath,
  };
}
