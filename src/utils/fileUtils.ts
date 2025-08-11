import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as ts from 'typescript';

// Cache for tsconfig to avoid reading it multiple times
let tsconfigCache: { compilerOptions?: ts.CompilerOptions; baseUrl?: string } | null = null;

function loadTsConfig(): { compilerOptions?: ts.CompilerOptions; baseUrl?: string } {
  if (tsconfigCache) {
    return tsconfigCache;
  }
  
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return {};
  }
  
  // Look for tsconfig.json
  for (const folder of workspaceFolders) {
    const tsconfigPath = path.join(folder.uri.fsPath, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      try {
        const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        if (configFile.config) {
          const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            folder.uri.fsPath
          );
          tsconfigCache = {
            compilerOptions: parsedConfig.options,
            baseUrl: folder.uri.fsPath
          };
          return tsconfigCache;
        }
      } catch (error) {
        console.error('Error reading tsconfig.json:', error);
      }
    }
  }
  
  return {};
}

export function resolveImportPath(importPath: string, currentFilePath: string): string | null {
  // Handle TypeScript path mappings from tsconfig.json
  const tsConfig = loadTsConfig();
  
  if (tsConfig.compilerOptions?.paths && tsConfig.baseUrl) {
    // Check if the import matches any path mapping
    for (const [pattern, replacements] of Object.entries(tsConfig.compilerOptions.paths)) {
      // Convert the pattern to a regex (e.g., "@/*" becomes a regex)
      const regexPattern = pattern.replace('*', '(.*)').replace('/', '\\/');
      const regex = new RegExp(`^${regexPattern}$`);
      const match = importPath.match(regex);
      
      if (match && replacements.length > 0) {
        // Take the first replacement pattern
        const replacement = replacements[0];
        const resolvedImport = replacement.replace('*', match[1] || '');
        
        // Resolve relative to baseUrl
        const fullPath = path.join(tsConfig.baseUrl, resolvedImport);
        const resolved = tryResolveWithExtensions(fullPath);
        if (resolved) {
          return resolved;
        }
      }
    }
  }
  
  // Fallback to simple @/ resolution if no tsconfig paths
  if (importPath.startsWith('@/')) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        // Try to resolve @/ as src/
        const srcPath = path.join(folder.uri.fsPath, 'src', importPath.substring(2));
        const resolved = tryResolveWithExtensions(srcPath);
        if (resolved) {
          return resolved;
        }
        
        // Also try @/ as the root folder itself
        const rootPath = path.join(folder.uri.fsPath, importPath.substring(2));
        const resolvedRoot = tryResolveWithExtensions(rootPath);
        if (resolvedRoot) {
          return resolvedRoot;
        }
      }
    }
  }
  
  // Handle relative imports
  if (!importPath.startsWith('.') && !importPath.startsWith('@')) {
    return null;
  }

  const dir = path.dirname(currentFilePath);
  const resolvedPath = path.resolve(dir, importPath);
  
  return tryResolveWithExtensions(resolvedPath);
}

function tryResolveWithExtensions(resolvedPath: string): string | null {
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