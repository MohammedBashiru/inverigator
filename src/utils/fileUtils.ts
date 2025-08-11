import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function resolveImportPath(importPath: string, currentFilePath: string): string | null {
  if (!importPath.startsWith('.')) {
    return null;
  }

  const dir = path.dirname(currentFilePath);
  const resolvedPath = path.resolve(dir, importPath);
  
  // Try different extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
  
  for (const ext of extensions) {
    const fullPath = resolvedPath.endsWith('.ts') || resolvedPath.endsWith('.js') 
      ? resolvedPath 
      : resolvedPath + ext;
    
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  
  return null;
}

export async function findFiles(pattern: string, exclude?: string): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles(pattern, exclude || '**/node_modules/**');
}

export function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
}

export function camelToSnake(str: string): string {
  return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1_$2').toLowerCase();
}

export async function searchForClass(className: string): Promise<vscode.Uri[]> {
  const searchPatterns = [
    `**/${className}.ts`,
    `**/${className}.js`,
    `**/${className}.tsx`,
    `**/${className}.jsx`,
    `**/${className.charAt(0).toLowerCase() + className.slice(1)}.ts`,
    `**/${camelToKebab(className)}.ts`,
    `**/${camelToSnake(className)}.ts`
  ];

  let foundFiles: vscode.Uri[] = [];
  
  for (const pattern of searchPatterns) {
    const files = await findFiles(pattern);
    foundFiles.push(...files);
    if (foundFiles.length > 0) {
      break;
    }
  }

  // If not found by filename, search content
  if (foundFiles.length === 0) {
    const allTsFiles = await findFiles('**/*.{ts,tsx}');
    
    for (const file of allTsFiles) {
      const content = fs.readFileSync(file.fsPath, 'utf-8');
      const classRegex = new RegExp(`(?:export\\s+)?(?:class|interface)\\s+${className}\\b`);
      if (classRegex.test(content)) {
        foundFiles.push(file);
      }
    }
  }

  return foundFiles;
}