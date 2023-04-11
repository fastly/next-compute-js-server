/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 *
 * Portions of this file Copyright Vercel, Inc., licensed under the MIT license. See LICENSE file for details.
 */

import { join, relative } from 'path';

import {
  APP_PATHS_MANIFEST,
  FONT_MANIFEST,
  PAGES_MANIFEST,
  SERVER_DIRECTORY,
  SERVERLESS_DIRECTORY
} from 'next/constants';
import { PagesManifest } from 'next/dist/build/webpack/plugins/pages-manifest-plugin';
import { normalizeLocalePath } from 'next/dist/shared/lib/i18n/normalize-locale-path';
import { denormalizePagePath } from 'next/dist/shared/lib/page-path/denormalize-page-path';
import { normalizePagePath } from 'next/dist/shared/lib/page-path/normalize-page-path';
import { MissingStaticPage, PageNotFoundError } from 'next/dist/shared/lib/utils';

import type { ContentAssets, ModuleAssets } from "@fastly/compute-js-static-publish";

/**
 * Finds the path that corresponds to a page, based on the pages manifest and localizations.
 * (An adaptation for Compute@Edge of function in Next.js of the same name,
 * found at next/server/require.ts)
 */
export function getPagePath(
  contentAssets: ContentAssets,
  page: string,
  dir: string,
  distDir: string,
  serverless: boolean,
  dev?: boolean,
  locales?: string[],
  appDirEnabled?: boolean
): string {
  const serverBuildPath = join(
    distDir,
    serverless && !dev ? SERVERLESS_DIRECTORY : SERVER_DIRECTORY
  );
  let rootPathsManifest: undefined | PagesManifest;

  if (appDirEnabled) {
    rootPathsManifest = readAssetManifest(
      contentAssets,
      join(serverBuildPath, APP_PATHS_MANIFEST),
      dir
    );
  }
  const pagesManifest = readAssetManifest(
    contentAssets,
    join(serverBuildPath, PAGES_MANIFEST),
    dir
  ) as PagesManifest;

  try {
    page = denormalizePagePath(normalizePagePath(page));
  } catch (err) {
    console.error(err);
    throw new PageNotFoundError(page);
  }

  const checkManifest = (manifest: PagesManifest) => {
    let curPath = manifest[page];

    if (!manifest[curPath] && locales) {
      const manifestNoLocales: typeof pagesManifest = {};

      for (const key of Object.keys(manifest)) {
        manifestNoLocales[normalizeLocalePath(key, locales).pathname] =
          pagesManifest[key];
      }
      curPath = manifestNoLocales[page];
    }
    return curPath;
  }
  let pagePath: string | undefined;

  if (rootPathsManifest) {
    pagePath = checkManifest(rootPathsManifest);
  }

  if (!pagePath) {
    pagePath = checkManifest(pagesManifest);
  }

  if (!pagePath) {
    throw new PageNotFoundError(page);
  }
  return join(serverBuildPath, pagePath);
}

/**
 * Loads the string or module that corresponds to a page.
 * (An adaptation for Compute@Edge of function in Next.js of the same name,
 * found at next/server/require.ts)
 */
export async function requirePage(
  contentAssets: ContentAssets,
  moduleAssets: ModuleAssets,
  page: string,
  dir: string,
  distDir: string,
  serverless: boolean,
  appDirEnabled?: boolean
): Promise<any> {
  const pagePath = getPagePath(
    contentAssets,
    page,
    dir,
    distDir,
    serverless,
    false,
    undefined,
    appDirEnabled
  );
  if (pagePath.endsWith('.html')) {
    try {
      return readAssetFileAsString(contentAssets, pagePath, dir);
    } catch(err: any) {
      throw new MissingStaticPage(page, err.message);
    }
  }
  return await readAssetModule(moduleAssets, pagePath, dir);
}

/**
 * Load the font manifest.
 * (An adaptation for Compute@Edge of function in Next.js of the same name,
 * found at next/server/require.ts)
 */
export function requireFontManifest(
  contentAssets: ContentAssets,
  distDir: string,
  dir: string,
  serverless: boolean,
) {
  const serverBuildPath = join(
    distDir,
    serverless ? SERVERLESS_DIRECTORY : SERVER_DIRECTORY
  );
  return readAssetManifest(
    contentAssets,
    join(serverBuildPath, FONT_MANIFEST),
    dir,
  );
}

/* ---- */

export function assetDirectoryExists(
  contentAssets: ContentAssets,
  path: string,
  dir: string,
): boolean {
  const relativePath = relative(dir, path);
  return Object.keys(contentAssets).some(key => key.startsWith('/' + relativePath + '/'));
}

export function assetDirectory(
  contentAssets: ContentAssets,
  path: string,
  dir: string,
): string[] {
  const relativePath = relative(dir, path);
  return Object.keys(contentAssets)
    .filter(key => key.startsWith('/' + relativePath + '/'));
}

export function assetFileExists(
  contentAssets: ContentAssets,
  path: string,
  dir: string
) {
  const relativePath = relative(dir, path);
  return contentAssets.getAsset('/' + relativePath) != null;
}

export function readAssetFile(
  contentAssets: ContentAssets,
  path: string,
  dir: string,
) {
  const relativePath = relative(dir, path);
  const file = contentAssets.getAsset('/' + relativePath);
  return file?.getBytes() ?? new Uint8Array(0);
}

export function readAssetFileAsString(
  contentAssets: ContentAssets,
  path: string,
  dir: string,
) {
  const relativePath = relative(dir, path);
  const file = contentAssets.getAsset('/' + relativePath);
  return file?.getText() ?? '';
}

export function getAssetContentType(
  contentAssets: ContentAssets,
  path: string,
  dir: string,
) {
  const relativePath = relative(dir, path);
  const file = contentAssets.getAsset('/' + relativePath);
  return file?.getMetadata().contentType ?? '';
}

export function readAssetManifest(
  contentAssets: ContentAssets,
  path: string,
  dir: string,
) {
  let content = readAssetFileAsString(contentAssets, path, dir) ?? '';
  return JSON.parse(content);
}

export async function readAssetModule(
  moduleAssets: ModuleAssets,
  path: string,
  dir: string,
) {
  const relativePath = relative(dir, path);
  const file = moduleAssets.getAsset('/' + relativePath);
  return file?.getModule();
}

export function makeStreamIterator<T>(stream: ReadableStream<T>) {
  return {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader()!;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

