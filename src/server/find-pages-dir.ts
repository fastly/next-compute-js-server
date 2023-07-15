/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'path';

import { existsSync } from './fs';

export function findDir(dir: string, name: 'pages' | 'app'): string | null {
  // prioritize ./${name} over ./src/${name}
  let curDir = path.join(dir, name);
  if (existsSync(curDir)) return curDir;

  curDir = path.join(dir, 'src', name);
  if (existsSync(curDir)) return curDir;

  return null
}
