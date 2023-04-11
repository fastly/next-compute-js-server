/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { makeStreamIterator } from './require';
import { relative } from "path";

import type { IncomingMessage, ServerResponse } from 'http';
import type { ContentAssets } from "@fastly/compute-js-static-publish";

/**
 * Serves the contents of a file at a path.
 * (A reimplementation for Compute@Edge of function in Next.js of the same name,
 * found at next/server/serve-static.ts)
 */
export async function serveStatic(
  contentAssets: ContentAssets,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  dir: string,
): Promise<void> {

  const decodedPath = decodeURIComponent(path);

  const relativePath = relative(dir, decodedPath);
  const file = contentAssets.getAsset('/' + relativePath);
  if (file == null) {
    throw new Error('File not found');
  }
  const storeEntryBody = (await file?.getStoreEntry())?.body;
  if (storeEntryBody == null) {
    throw new Error('Could not obtain file stream');
  }

  res.statusCode = 200;
  res.statusMessage = 'OK';
  res.setHeader('Content-Type', file?.getMetadata().contentType);

  for await (const chunk of makeStreamIterator(storeEntryBody)) {
    res.write(chunk)
  }
}
