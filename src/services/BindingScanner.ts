import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import { Binding, BindingsMap } from '../types';
import { FILE_PATTERNS, PATTERNS } from '../constants';
import { createSourceFile, extractIdentifier } from '../utils/astUtils';
import { findFiles, resolveImportPath } from '../utils/fileUtils';
import { IgnorePatternMatcher } from '../utils/ignorePatterns';
import { CacheService } from './CacheService';

export class BindingScanner {
  private bindingsMap: BindingsMap = new Map();
  private processedFiles: Set<string> = new Set();
  private importedFunctions: Set<string> = new Set();
  private ignoreMatcher: IgnorePatternMatcher;
  private scanStartTime: number = 0;
  private maxFilesToScan: number = 1000;
  private scanTimeout: number = 30000;
  private cacheService: CacheService | null = null;
  private useCache: boolean = true;

  constructor(
    private outputChannel: vscode.OutputChannel,
    private diagnostics: vscode.DiagnosticCollection
  ) {
    this.ignoreMatcher = new IgnorePatternMatcher();
    const info = this.ignoreMatcher.getInfo();
    if (info.hasIgnoreFile) {
      this.outputChannel.appendLine(`Loaded .inverigatorignore file with ${info.customPatternCount} custom patterns`);
      this.outputChannel.appendLine(`Total ignore patterns (default + custom): ${info.totalPatternCount}`);
    } else {
      this.outputChannel.appendLine(`No .inverigatorignore file found. Using ${info.totalPatternCount} default patterns`);
    }
    
    // Initialize cache service if we have a workspace
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      this.cacheService = new CacheService(workspaceFolder.uri.fsPath, this.outputChannel);
    }
  }

  async scan(patterns: string[], maxDepth: number, progress?: vscode.Progress<{ message?: string; increment?: number }>, forceFullScan: boolean = false): Promise<BindingsMap> {
    this.bindingsMap.clear();
    this.processedFiles.clear();
    this.importedFunctions.clear();
    this.scanStartTime = Date.now();
    
    // Load config values
    const config = vscode.workspace.getConfiguration('inverigator');
    this.maxFilesToScan = config.get<number>('maxFilesToScan', 1000);
    this.scanTimeout = config.get<number>('scanTimeout', 30000);
    this.useCache = config.get<boolean>('useCache', true);
    
    // Handle unlimited values
    if (this.maxFilesToScan === -1) {
      this.maxFilesToScan = Number.MAX_SAFE_INTEGER;
      this.outputChannel.appendLine('Max files to scan: unlimited');
    }
    if (this.scanTimeout === -1) {
      this.scanTimeout = Number.MAX_SAFE_INTEGER;
      this.outputChannel.appendLine('Scan timeout: unlimited');
    }

    this.outputChannel.appendLine('\n=== Starting Binding Scan ===');
    this.outputChannel.appendLine(`Max files to scan: ${this.maxFilesToScan === Number.MAX_SAFE_INTEGER ? 'unlimited' : this.maxFilesToScan}`);
    this.outputChannel.appendLine(`Scan timeout: ${this.scanTimeout === Number.MAX_SAFE_INTEGER ? 'unlimited' : this.scanTimeout + 'ms'}`);
    this.outputChannel.appendLine(`Use cache: ${this.useCache}`);
    
    // Try to load from cache first (unless forced to do full scan)
    if (this.useCache && this.cacheService && !forceFullScan) {
      const cacheData = await this.cacheService.loadCache();
      if (cacheData) {
        this.outputChannel.appendLine('\nLoaded bindings from cache');
        this.outputChannel.appendLine(`  Cached bindings: ${cacheData.bindings.size}`);
        this.outputChannel.appendLine(`  Cache age: ${Math.round((Date.now() - cacheData.timestamp) / 1000)}s`);
        
        // Check if cache is still valid (e.g., not older than 1 hour)
        const maxCacheAge = config.get<number>('cacheMaxAge', 3600000); // 1 hour default
        if (await this.cacheService.isCacheValid(maxCacheAge)) {
          this.bindingsMap = cacheData.bindings;
          this.processedFiles = new Set(cacheData.scannedFiles);
          
          // Log cached bindings
          this.outputChannel.appendLine(`\n=== Cached Bindings ===`);
          let bindingCount = 0;
          this.bindingsMap.forEach((bindings) => {
            bindings.forEach(binding => {
              this.outputChannel.appendLine(`  ${binding.token} → ${binding.implementation}`);
              bindingCount++;
            });
          });
          this.outputChannel.appendLine(`Total cached bindings: ${bindingCount}`);
          this.outputChannel.appendLine(`=== End Cached Bindings ===\n`);
          
          return this.bindingsMap;
        } else {
          this.outputChannel.appendLine('Cache is invalid or expired, performing full scan');
        }
      } else {
        this.outputChannel.appendLine('No cache found, performing full scan');
      }
    } else if (forceFullScan) {
      this.outputChannel.appendLine('Forced full scan - bypassing cache');
    }
    
    // Use content-based search as the primary strategy
    // This is more reliable than pattern-based for finding all bindings
    await this.contentBasedScan(maxDepth, progress);
    
    // Also scan any explicitly configured patterns (like container.ts)
    // These might have configuration without direct bindings
    for (const pattern of patterns) {
      const files = await findFiles(pattern, this.ignoreMatcher);
      const nonTestFiles = files.filter(f => !this.isTestFile(f.fsPath));
      
      if (nonTestFiles.length > 0) {
        this.outputChannel.appendLine(`\nScanning configured pattern '${pattern}': ${nonTestFiles.length} files`);
        for (const file of nonTestFiles) {
          if (!this.processedFiles.has(file.fsPath)) {
            await this.scanContainerFile(file.fsPath, 0, maxDepth);
          }
        }
      }
    }

    // No longer needed - content-based scan handles this better

    
    // Log all found bindings for debugging
    this.outputChannel.appendLine(`\n=== All Bindings Found ===`);
    let bindingCount = 0;
    this.bindingsMap.forEach((bindings) => {
      bindings.forEach(binding => {
        this.outputChannel.appendLine(`  ${binding.token} → ${binding.implementation}`);
        bindingCount++;
      });
    });
    this.outputChannel.appendLine(`Total unique bindings: ${bindingCount}`);
    this.outputChannel.appendLine(`=== End Bindings ===\n`);

    this.outputChannel.appendLine(
      `Found ${this.bindingsMap.size} unique keys with bindings across ${this.processedFiles.size} files`
    );
    
    // Save to cache if enabled
    if (this.useCache && this.cacheService && this.bindingsMap.size > 0) {
      try {
        // For now, we're not caching injections separately, but we could extend this
        await this.cacheService.saveCache(
          this.bindingsMap,
          new Map(), // Empty injections map for now
          Array.from(this.processedFiles)
        );
        this.outputChannel.appendLine('Bindings saved to cache');
      } catch (error) {
        this.outputChannel.appendLine(`Failed to save cache: ${error}`);
      }
    }

    return this.bindingsMap;
  }

  private async scanContainerFile(filePath: string, depth: number, maxDepth: number) {
    // Check file limit
    if (this.processedFiles.size >= this.maxFilesToScan) {
      this.outputChannel.appendLine(`⚠️ Reached max file limit (${this.maxFilesToScan} files)`);
      return;
    }
    
    // Check timeout
    if (Date.now() - this.scanStartTime > this.scanTimeout) {
      this.outputChannel.appendLine(`⚠️ Scan timeout reached (${this.scanTimeout}ms)`);
      return;
    }
    
    // Skip ignored files
    if (this.ignoreMatcher.shouldIgnore(filePath)) {
      return;
    }
    
    if (this.processedFiles.has(filePath) || depth > maxDepth) {
      if (depth > maxDepth) {
        this.outputChannel.appendLine(`  Skipping ${path.basename(filePath)} - max depth ${maxDepth} reached`);
      }
      return;
    }

    this.processedFiles.add(filePath);
    this.outputChannel.appendLine(`\nScanning file (depth ${depth}): ${filePath}`);

    const sourceFile = createSourceFile(filePath);
    if (!sourceFile) {
      this.outputChannel.appendLine(`  Failed to parse: ${path.basename(filePath)}`);
      return;
    }

    try {
      // Parse bindings in this file
      const bindingCountBefore = this.bindingsMap.size;
      this.parseBindings(sourceFile, filePath);
      const bindingCountAfter = this.bindingsMap.size;
      
      if (bindingCountAfter > bindingCountBefore) {
        this.outputChannel.appendLine(`  Found ${bindingCountAfter - bindingCountBefore} new binding keys in ${path.basename(filePath)}`);
      } else {
        this.outputChannel.appendLine(`  No bindings found in ${path.basename(filePath)}`);
      }

      // Find and follow imported registry/configuration functions
      const importedModules = this.findImportedModules(sourceFile, filePath);
      
      // Find function calls that might configure sub-containers
      const functionCalls = this.findConfigurationFunctionCalls(sourceFile);

      // Scan imported modules - they might contain bindings even if not called
      for (const modulePath of importedModules) {
        await this.scanContainerFile(modulePath, depth + 1, maxDepth);
      }
      
      // If this file has registry function calls, look for the actual registry files
      if (functionCalls.size > 0 && importedModules.length === 0) {
        // Try to find registry files in the same directory or subdirectories
        const dir = path.dirname(filePath);
        const registryFiles = await this.findRegistryFiles(dir);
        for (const registryFile of registryFiles) {
          await this.scanContainerFile(registryFile, depth + 1, maxDepth);
        }
      }

      // Also scan files that match registry patterns
      const dir = path.dirname(filePath);
      const registryFiles = await this.findRegistryFiles(dir);
      for (const registryFile of registryFiles) {
        await this.scanContainerFile(registryFile, depth + 1, maxDepth);
      }

    } catch (error) {
      this.outputChannel.appendLine(`Error scanning ${filePath}: ${error}`);
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        `Failed to parse container file: ${error}`,
        vscode.DiagnosticSeverity.Warning
      );
      this.diagnostics.set(vscode.Uri.file(filePath), [diagnostic]);
    }
  }

  private async findRegistryFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    // Check if the directory is within the workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return files;
    }
    
    // Convert absolute dir to workspace-relative path
    let relativeDirPattern: string | null = null;
    for (const folder of workspaceFolders) {
      if (dir.startsWith(folder.uri.fsPath)) {
        // Get the relative path from workspace root
        relativeDirPattern = path.relative(folder.uri.fsPath, dir).replace(/\\/g, '/');
        break;
      }
    }
    
    // If dir is not in workspace, try to use it as-is
    if (relativeDirPattern === null) {
      relativeDirPattern = vscode.workspace.asRelativePath(dir);
    }
    
    for (const pattern of FILE_PATTERNS.registry) {
      // Create a glob pattern relative to the workspace
      const globPattern = relativeDirPattern ? 
        `${relativeDirPattern}/${pattern}` : 
        pattern;
      
      const foundFiles = await findFiles(globPattern, this.ignoreMatcher);
      files.push(...foundFiles.map(f => f.fsPath));
    }
    
    return [...new Set(files)];
  }

  private findImportedModules(sourceFile: ts.SourceFile, currentFilePath: string): string[] {
    const imports: string[] = [];

    ts.forEachChild(sourceFile, node => {
      // Handle import declarations
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          const importPath = moduleSpecifier.text;
          
          // Track imported functions for configuration detection
          if (node.importClause && node.importClause.namedBindings) {
            if (ts.isNamedImports(node.importClause.namedBindings)) {
              node.importClause.namedBindings.elements.forEach(element => {
                const name = element.name.getText(sourceFile);
                // Check if this is a registry/configuration function
                if (name.includes('Configure') || 
                    name.includes('Registry') || 
                    name.includes('register') ||
                    name.includes('Bind') ||
                    PATTERNS.configurationFunctions.some(pattern => name.includes(pattern))) {
                  this.importedFunctions.add(name);
                  
                  // Also add the module to imports to scan it
                  const resolvedPath = resolveImportPath(importPath, currentFilePath);
                  if (resolvedPath && !imports.includes(resolvedPath)) {
                    imports.push(resolvedPath);
                    this.outputChannel.appendLine(`  Found registry import: ${name} from ${path.basename(resolvedPath)}`);
                  }
                }
              });
            }
          }

          // Always resolve registry imports
          if (importPath.includes('registry') || importPath.includes('Registry')) {
            const resolvedPath = resolveImportPath(importPath, currentFilePath);
            if (resolvedPath && !imports.includes(resolvedPath)) {
              imports.push(resolvedPath);
            }
          }
        }
      }
      
      // Handle export declarations (for index files that re-export)
      if (ts.isExportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
          const exportPath = moduleSpecifier.text;
          
          // Log what we're exporting
          let exportInfo = 'all';
          if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            const names = node.exportClause.elements.map(e => e.name.getText(sourceFile));
            exportInfo = names.join(', ');
            
            // Track these as potential registry functions
            names.forEach(name => {
              if (name.includes('Configure') || 
                  name.includes('Registry') || 
                  name.includes('register') ||
                  name.includes('Bind')) {
                this.importedFunctions.add(name);
              }
            });
          }
          
          // Always follow exports to scan the target file
          const resolvedPath = resolveImportPath(exportPath, currentFilePath);
          if (resolvedPath && !imports.includes(resolvedPath)) {
            imports.push(resolvedPath);
            this.outputChannel.appendLine(`  Found export of ${exportInfo} from: ${exportPath} -> ${path.basename(resolvedPath)}`);
          }
        }
      }
    });

    return imports;
  }

  private findConfigurationFunctionCalls(sourceFile: ts.SourceFile): Set<string> {
    const functionCalls = new Set<string>();

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(sourceFile);
        // Look for configuration function patterns
        if (text.includes('Configure') ||
            text.includes('Registry') ||
            text.includes('register') ||
            text.includes('Bind') ||
            PATTERNS.configurationFunctions.some(pattern => text.includes(pattern)) ||
            this.importedFunctions.has(text)) {
          functionCalls.add(text);
          this.outputChannel.appendLine(`  Found configuration call: ${text}`);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return functionCalls;
  }

  private parseBindings(sourceFile: ts.SourceFile, filePath: string) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const binding = this.extractBinding(node, sourceFile, filePath);
        if (binding) {
          // Store the binding with all possible key variations
          this.storeBinding(binding);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    
    // Also try text-based pattern matching for complex or minified code
    this.parseBindingsTextBased(sourceFile, filePath);
    
    // Look for Symbol or const definitions that might be used as tokens
    this.findTokenDefinitions(sourceFile, filePath);
  }
  
  private storeBinding(binding: Binding) {
    // Store with the main token
    const existing = this.bindingsMap.get(binding.token) || [];
    if (!existing.some(b => b.implementation === binding.implementation && b.file === binding.file)) {
      existing.push(binding);
      this.bindingsMap.set(binding.token, existing);
    }
    
    // Also map by implementation name for easier lookup
    const implBindings = this.bindingsMap.get(binding.implementation) || [];
    if (!implBindings.some(b => b.token === binding.token)) {
      implBindings.push(binding);
      this.bindingsMap.set(binding.implementation, implBindings);
    }
    
    // If token contains dots (like TYPES.Something), also store without prefix
    if (binding.token.includes('.')) {
      const parts = binding.token.split('.');
      const shortToken = parts[parts.length - 1];
      const shortBindings = this.bindingsMap.get(shortToken) || [];
      if (!shortBindings.some(b => b.implementation === binding.implementation)) {
        shortBindings.push(binding);
        this.bindingsMap.set(shortToken, shortBindings);
      }
    }
  }
  
  private findTokenDefinitions(sourceFile: ts.SourceFile, filePath: string) {
    const text = sourceFile.getFullText();
    
    // Look for TYPES object definitions
    const typesPattern = /(?:const|let|var)\s+TYPES\s*=\s*\{([^}]+)\}/g;
    let match = typesPattern.exec(text);
    
    if (match) {
      const typesContent = match[1];
      // Extract token names from TYPES object
      const tokenPattern = /(\w+)\s*:\s*Symbol(?:\.for)?\(['"]([^'"]+)['"]\)/g;
      let tokenMatch;
      
      while ((tokenMatch = tokenPattern.exec(typesContent)) !== null) {
        const tokenName = tokenMatch[1];
        const symbolValue = tokenMatch[2];
        
        // Store this as a potential token that might be used in bindings
        this.outputChannel.appendLine(
          `Found TYPES token definition: TYPES.${tokenName} = Symbol('${symbolValue}') in ${path.basename(filePath)}`
        );
        
        // We'll look for bindings using this token in the same file
        const bindingPattern = new RegExp(
          `\\.bind\\s*(?:<[^>]+>)?\\s*\\(\\s*TYPES\\.${tokenName}\\s*\\)[\\s\\S]*?\\.to(?:Self|Service|ConstantValue|Factory)?\\s*\\(\\s*([A-Za-z_][A-Za-z0-9_]*?)\\s*\\)`,
          'g'
        );
        
        let bindingMatch;
        while ((bindingMatch = bindingPattern.exec(text)) !== null) {
          const implementation = bindingMatch[1];
          if (implementation) {
            const pos = sourceFile.getLineAndCharacterOfPosition(bindingMatch.index);
            const binding: Binding = {
              token: `TYPES.${tokenName}`,
              implementation,
              file: filePath,
              line: pos.line
            };
            this.storeBinding(binding);
            this.outputChannel.appendLine(
              `Found binding from TYPES definition: TYPES.${tokenName} → ${implementation}`
            );
          }
        }
      }
    }
  }
  
  private parseBindingsTextBased(sourceFile: ts.SourceFile, filePath: string) {
    const text = sourceFile.getFullText();
    
    // Multiple patterns to catch different binding styles
    const patterns = [
      // Pattern for bind(TOKEN).to(Implementation)
      /\.bind\s*\(\s*([A-Za-z_][A-Za-z0-9_\.]*?)\s*\)[\s\S]*?\.to(?:Self|Service|ConstantValue|Factory)?\s*\(\s*([A-Za-z_][A-Za-z0-9_]*?)\s*\)/g,
      // Pattern for bind<Interface>(TOKEN).to(Implementation)
      /\.bind\s*<[^>]+>\s*\(\s*([A-Za-z_][A-Za-z0-9_\.]*?)\s*\)[\s\S]*?\.to(?:Self|Service|ConstantValue|Factory)?\s*\(\s*([A-Za-z_][A-Za-z0-9_]*?)\s*\)/g,
      // Pattern for rebind variations
      /\.rebind\s*(?:<[^>]+>)?\s*\(\s*([A-Za-z_][A-Za-z0-9_\.]*?)\s*\)[\s\S]*?\.to(?:Self|Service|ConstantValue|Factory)?\s*\(\s*([A-Za-z_][A-Za-z0-9_]*?)\s*\)/g
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const token = match[1];
        const implementation = match[2];
        
        if (token && implementation) {
          const pos = sourceFile.getLineAndCharacterOfPosition(match.index);
          const binding: Binding = {
            token,
            implementation,
            file: filePath,
            line: pos.line
          };
          this.storeBinding(binding);
          
          this.outputChannel.appendLine(
            `Found binding (text-based): ${token} → ${implementation} in ${path.basename(filePath)}`
          );
        }
      }
    }
  }

  private extractBinding(node: ts.CallExpression, sourceFile: ts.SourceFile, filePath: string): Binding | null {
    const text = node.expression.getText(sourceFile);
    
    // Check for container.bind or just bind pattern
    if (!text.includes('.bind') && !text.endsWith('bind')) {
      return null;
    }

    // Get the token from bind()
    if (node.arguments.length === 0) {
      return null;
    }

    const tokenArg = node.arguments[0];
    let token = extractIdentifier(tokenArg, sourceFile);
    
    // Also store the original token text for better matching
    const originalTokenText = tokenArg.getText(sourceFile).trim();

    // Look for .to() in the chain
    let currentNode: ts.Node = node;
    let implementation: string | null = null;

    // Try to find .to() by traversing up and down the AST
    const findToCall = (startNode: ts.Node, depth: number = 0): string | null => {
      if (depth > 5) {
        return null;
      }
      
      // Check if parent is a property access for .to()
      if (ts.isPropertyAccessExpression(startNode.parent)) {
        const propAccess = startNode.parent;
        const propName = propAccess.name.getText(sourceFile);
        
        if ((propName === 'to' || propName === 'toService' || propName === 'toConstantValue' || propName === 'toFactory') && 
            propAccess.parent && 
            ts.isCallExpression(propAccess.parent)) {
          const toCall = propAccess.parent;
          if (toCall.arguments.length > 0) {
            return extractIdentifier(toCall.arguments[0], sourceFile);
          }
        }
        // Continue up the chain
        return findToCall(startNode.parent, depth + 1);
      } else if (ts.isCallExpression(startNode.parent)) {
        // Continue up the chain
        return findToCall(startNode.parent, depth + 1);
      }
      
      return null;
    };

    implementation = findToCall(node);

    // Also check for toSelf() pattern
    if (!implementation && currentNode.parent) {
      const parentText = currentNode.parent.getText(sourceFile);
      if (parentText.includes('.toSelf()')) {
        implementation = token; // Token is its own implementation
      }
    }

    // Also check for toService() pattern
    if (!implementation && currentNode.parent) {
      const parentText = currentNode.parent.getText(sourceFile);
      const toServiceMatch = parentText.match(/\.toService\s*\(\s*([^)]+)\s*\)/);
      if (toServiceMatch) {
        implementation = toServiceMatch[1].trim();
      }
    }

    if (token && implementation) {
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      this.outputChannel.appendLine(
        `Found binding: ${token} → ${implementation} in ${path.basename(filePath)}`
      );
      const binding = {
        token,
        implementation,
        file: filePath,
        line: pos.line
      };
      
      // Store with both the clean token and the original format if different
      if (originalTokenText && originalTokenText !== token) {
        // Also store with the original format
        const existingOriginal = this.bindingsMap.get(originalTokenText) || [];
        if (!existingOriginal.some(b => b.token === token && b.implementation === implementation)) {
          existingOriginal.push(binding);
          this.bindingsMap.set(originalTokenText, existingOriginal);
        }
      }
      
      return binding;
    } else if (token && !implementation) {
      // Log that we found a bind but couldn't find the implementation
      this.outputChannel.appendLine(
        `Found bind(${token}) but couldn't find .to() implementation in ${path.basename(filePath)}`
      );
    }

    return null;
  }

  private async contentBasedScan(maxDepth: number, progress?: vscode.Progress<{ message?: string; increment?: number }>) {
    this.outputChannel.appendLine('Searching for files containing Inversify bindings...');
    
    if (progress) {
      progress.report({ message: 'Searching for TypeScript files...' });
    }
    
    // Search for TypeScript files that likely contain bindings
    // Now using ignoreMatcher directly in findFiles for efficient exclusion
    const allTsFiles = await findFiles('**/*.{ts,tsx}', this.ignoreMatcher);
    
    // Use ignore patterns to filter files
    const candidateFiles = this.ignoreMatcher.filterFiles(allTsFiles);
    
    this.outputChannel.appendLine(`Found ${candidateFiles.length} TypeScript files to analyze (excluded ${allTsFiles.length - candidateFiles.length} files)`);
    
    if (progress) {
      progress.report({ message: `Analyzing ${candidateFiles.length} TypeScript files...` });
    }
    
    // First pass: Quick scan to find files with binding patterns
    const bindingFiles: vscode.Uri[] = [];
    const containerFiles: vscode.Uri[] = [];
    
    // Process in batches for better performance
    const batchSize = 50;
    const totalFiles = candidateFiles.length;
    for (let i = 0; i < candidateFiles.length; i += batchSize) {
      const batch = candidateFiles.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (file) => {
        if (this.processedFiles.has(file.fsPath)) {
          return;
        }
        
        try {
          const doc = await vscode.workspace.openTextDocument(file);
          const text = doc.getText();
          
          // Check for different binding patterns
          const hasBindings = text.includes('.bind(') || 
                            text.includes('.rebind(') ||
                            text.includes('.toSelf(') ||
                            text.includes('.toService(');
          
          const hasContainer = text.includes('new Container(') ||
                              text.includes('container.') ||
                              text.includes('Container.');
          
          if (hasBindings) {
            bindingFiles.push(file);
          } else if (hasContainer) {
            containerFiles.push(file);
          }
        } catch (error) {
          // Ignore files we can't read
        }
      }));
      
      // Update progress
      const processed = Math.min(i + batchSize, candidateFiles.length);
      if ((i + batchSize) % 200 === 0 || i + batchSize >= candidateFiles.length) {
        this.outputChannel.appendLine(`  Analyzed ${processed}/${candidateFiles.length} files...`);
      }
      if (progress) {
        const percentage = Math.round((processed / totalFiles) * 100);
        progress.report({ message: `Analyzing files... (${percentage}%)` });
      }
    }
    
    this.outputChannel.appendLine(`\nFound ${bindingFiles.length} files with bindings, ${containerFiles.length} files with container references`);
    
    // Scan binding files first (they have actual bindings)
    if (bindingFiles.length > 0) {
      this.outputChannel.appendLine('\nScanning files with bindings:');
      if (progress) {
        progress.report({ message: `Processing ${bindingFiles.length} files with bindings...` });
      }
      for (let i = 0; i < bindingFiles.length; i++) {
        await this.scanContainerFile(bindingFiles[i].fsPath, 0, Math.min(maxDepth, 3));
        if (progress && i % 5 === 0) {
          const percentage = Math.round(((i + 1) / bindingFiles.length) * 100);
          progress.report({ message: `Processing binding files... (${percentage}%)` });
        }
      }
    }
    
    // Then scan container files (might have configuration)
    if (containerFiles.length > 0) {
      this.outputChannel.appendLine(`\nScanning files with container references: ${containerFiles.length} files`);
      
      // Use a configurable limit or default to a reasonable number
      const config = vscode.workspace.getConfiguration('inverigator');
      const maxContainerFiles = config.get<number>('maxContainerFilesToScan', 100);
      
      const filesToScan = maxContainerFiles === -1 ? 
        containerFiles : 
        containerFiles.slice(0, maxContainerFiles);
      
      if (filesToScan.length < containerFiles.length) {
        this.outputChannel.appendLine(`  Limiting to first ${filesToScan.length} container files (of ${containerFiles.length} total)`);
      }
      
      if (progress) {
        progress.report({ message: `Processing ${filesToScan.length} container files...` });
      }
      for (let i = 0; i < filesToScan.length; i++) {
        if (!this.processedFiles.has(filesToScan[i].fsPath)) {
          await this.scanContainerFile(filesToScan[i].fsPath, 0, Math.min(maxDepth, 2));
          if (progress && i % 3 === 0) {
            const percentage = Math.round(((i + 1) / filesToScan.length) * 100);
            progress.report({ message: `Processing container files... (${percentage}%)` });
          }
        }
      }
    }
  }
  
  private isTestFile(filePath: string): boolean {
    // Now handled by IgnorePatternMatcher, but kept for backward compatibility
    return this.ignoreMatcher.shouldIgnore(filePath);
  }
  
  getProcessedFilesCount(): number {
    return this.processedFiles.size;
  }
  
  async clearCache(): Promise<void> {
    if (this.cacheService) {
      await this.cacheService.clearCache();
      this.outputChannel.appendLine('Cache cleared');
    }
  }
  
  async getCacheStats(): Promise<any> {
    if (this.cacheService) {
      return await this.cacheService.getCacheStats();
    }
    return { exists: false };
  }
  
  async hasCachedData(): Promise<boolean> {
    if (this.cacheService) {
      return await this.cacheService.cacheExists();
    }
    return false;
  }
  
  getIgnoreMatcher(): IgnorePatternMatcher {
    return this.ignoreMatcher;
  }
}