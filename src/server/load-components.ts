/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 *
 * Portions of this file Copyright Vercel, Inc., licensed under the MIT license. See LICENSE file for details.
 */

import { join } from 'path';

import {
  BUILD_MANIFEST,
  CLIENT_REFERENCE_MANIFEST,
  REACT_LOADABLE_MANIFEST,
  SERVER_DIRECTORY,
  SERVER_REFERENCE_MANIFEST,
} from 'next/constants';
import { interopDefault } from 'next/dist/lib/interop-default';
import { requireManifest, requirePage } from './require';
import { getTracer } from 'next/dist/server/lib/trace/tracer';
import { LoadComponentsSpan } from 'next/dist/server/lib/trace/constants';

import type { BuildManifest } from 'next/dist/server/get-page-files';
import type { LoadComponentsReturnType, ReactLoadableManifest } from 'next/dist/server/load-components';

async function loadManifest<T>(manifestPath: string, _ = 1): Promise<T> {
  return requireManifest(manifestPath) as T;
}

/**
 * Loads React component associated with a given pathname.
 * (An adaptation for Compute@Edge of function in Next.js of the same name,
 * found at next/server/load-components.ts)
 *
 * Differences:
 *  * serverless is not supported
 *  * use
 */
export async function loadComponentsImpl({
  distDir,
  pathname,
  hasServerComponents,
  isAppPath,
}: {
  distDir: string
  pathname: string
  hasServerComponents: boolean
  isAppPath: boolean
}): Promise<LoadComponentsReturnType> {
  let DocumentMod = {};
  let AppMod = {};
  if (!isAppPath) {
    [DocumentMod, AppMod] = await Promise.all([
      Promise.resolve().then(() => requirePage('/_document', distDir, false)),
      Promise.resolve().then(() => requirePage('/_app', distDir, false)),
    ]);
  }
  const ComponentMod = await Promise.resolve().then(() =>
    requirePage(pathname, distDir, isAppPath)
  );

  const [
    buildManifest,
    reactLoadableManifest,
    serverComponentManifest,
    serverActionsManifest,
  ] =
    await Promise.all([
      loadManifest<BuildManifest>(join(distDir, BUILD_MANIFEST)),
      loadManifest<ReactLoadableManifest>(join(distDir, REACT_LOADABLE_MANIFEST)),
      hasServerComponents ?
        loadManifest(
          join(distDir, SERVER_DIRECTORY, CLIENT_REFERENCE_MANIFEST + '.json')
        ) :
        null,
      hasServerComponents ?
        loadManifest(
          join(distDir, SERVER_DIRECTORY, SERVER_REFERENCE_MANIFEST + '.json')
        )
          .catch(() => null) :
        null,
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
    serverActionsManifest,
    isAppPath,
    pathname,
  };
}

export const loadComponents = getTracer().wrap(
  LoadComponentsSpan.loadComponents,
  loadComponentsImpl
);
