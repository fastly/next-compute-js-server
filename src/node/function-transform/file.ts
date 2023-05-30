import fs from 'fs';

export function writeFile(filePath: string, contents: string, description: string) {

  console.log(`Writing ${description} '${filePath}'...`);
  fs.writeFileSync(
    filePath,
    contents,
    'utf-8'
  );

}

function copyFileOrFiles(srcPath: string, destPath: string, description: string, recursive: boolean = false, filter: fs.CopySyncOptions['filter'] = undefined) {

  console.log(`Copying ${description} from '${srcPath}' to '${destPath}'...`);
  fs.cpSync(
    srcPath,
    destPath,
    {
      recursive,
      filter,
    }
  );

}

export function copyFile(srcPath: string, destPath: string, description: string) {

  copyFileOrFiles(srcPath, destPath, description, false);

}

export function copyFiles(srcPath: string, destPath: string, description: string, filter: fs.CopySyncOptions['filter'] = undefined) {

  copyFileOrFiles(srcPath, destPath, description, true, filter);

}

