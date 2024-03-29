/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 *
 * Portions of this file Copyright Vercel, Inc., licensed under the MIT license. See LICENSE file for details.
 */

import { join, resolve } from 'path';

import {
  APP_PATHS_MANIFEST,
  FONT_MANIFEST,
  PAGES_MANIFEST,
  SERVER_DIRECTORY,
} from 'next/constants';
import { PagesManifest } from 'next/dist/build/webpack/plugins/pages-manifest-plugin';
import { normalizeLocalePath } from 'next/dist/shared/lib/i18n/normalize-locale-path';
import { denormalizePagePath } from 'next/dist/shared/lib/page-path/denormalize-page-path';
import { normalizePagePath } from 'next/dist/shared/lib/page-path/normalize-page-path';
import { MissingStaticPage, PageNotFoundError } from 'next/dist/shared/lib/utils';

import { getFsSettings } from './fs';

/**
 * Finds the path that corresponds to a page, based on the pages manifest and localizations.
 * (An adaptation for Compute of function in Next.js of the same name,
 * found at next/server/require.ts)
 */
export function getPagePath(
  page: string,
  distDir: string,
  serverless: boolean,
  dev?: boolean,
  locales?: string[],
  appDirEnabled?: boolean
): string {
  if (serverless) {
    throw new Error("serverless not supported for this platform!");
  }

  const serverBuildPath = join(
    distDir,
    SERVER_DIRECTORY
  );
  let rootPathsManifest: undefined | PagesManifest;

  if (appDirEnabled) {
    rootPathsManifest = requireManifest(join(serverBuildPath, APP_PATHS_MANIFEST));
  }
  const pagesManifest = requireManifest(join(
    serverBuildPath,
    PAGES_MANIFEST
  )) as PagesManifest;

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
 * (An adaptation for Compute of function in Next.js of the same name,
 * found at next/server/require.ts)
 */
export async function requirePage(
  page: string,
  distDir: string,
  serverless: boolean,
  appDirEnabled?: boolean
): Promise<any> {
  const pagePath = getPagePath(
    page,
    distDir,
    serverless,
    false,
    undefined,
    appDirEnabled
  );
  if (pagePath.endsWith('.html')) {
    try {
      return readAssetFileAsString(pagePath);
    } catch(err: any) {
      throw new MissingStaticPage(page, err.message);
    }
  }
  return await requireModule(pagePath);
}

/**
 * Load the font manifest.
 * (An adaptation for Compute of function in Next.js of the same name,
 * found at next/server/require.ts)
 */
export function requireFontManifest(distDir: string, serverless: boolean) {
  if (serverless) {
    throw new Error("serverless not supported for this platform!");
  }
  const serverBuildPath = join(
    distDir,
    SERVER_DIRECTORY
  );
  const fontManifest = requireManifest(join(serverBuildPath, FONT_MANIFEST));
  return fontManifest;
}

/* ---- */

export function assetDirectoryExists(
  path: string,
): boolean {
  const { contentAssets, dir } = getFsSettings();
  const relativePath = resolve(dir, path);
  return contentAssets.getAssetKeys()
    .some(key => key.startsWith(relativePath + '/'));
}

export function assetDirectory(
  path: string,
): string[] {
  const { contentAssets, dir } = getFsSettings();
  const relativePath = resolve(dir, path);
  return contentAssets.getAssetKeys()
    .filter(key => key.startsWith(relativePath + '/'));
}

export function assetFileExists(
  path: string,
) {
  const { contentAssets, dir } = getFsSettings();
  const relativePath = resolve(dir, path);
  return contentAssets.getAsset(relativePath) != null;
}

export function readAssetFileAsString(
  path: string,
) {
  const { contentAssets, dir } = getFsSettings();
  const relativePath = resolve(dir, path);
  const file = contentAssets.getAsset(relativePath);
  return file?.getText() ?? '';
}

export function requireManifest(
  path: string,
) {
  let content = readAssetFileAsString(path) ?? '';
  return JSON.parse(content);
}

export async function requireModule(
  path: string,
) {
  // TODO: eventually move this out into its own package
  const { moduleAssets, dir } = getFsSettings();
  // Do Node.js magic to find file
  const relativePath = resolve(dir, path);
  const file =
    moduleAssets.getAsset(relativePath) ??
    moduleAssets.getAsset(relativePath + '.js') ??
    // NOTE: Node.js would check .json here, before index.js
    moduleAssets.getAsset(relativePath + '/index.js') ??
    null;
  if (file == null) {
    throw { relativePath, 'code': 'MODULE_NOT_FOUND' };
  }
  return file.getModule();
}
