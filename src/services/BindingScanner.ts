import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import { Binding, BindingsMap } from '../types';
import { FILE_PATTERNS, PATTERNS } from '../constants';
import { createSourceFile, extractIdentifier } from '../utils/astUtils';
import { findFiles, resolveImportPath } from '../utils/fileUtils';

export class BindingScanner {
  private bindingsMap: BindingsMap = new Map();
  private processedFiles: Set<string> = new Set();
  private importedFunctions: Set<string> = new Set();

  constructor(
    private outputChannel: vscode.OutputChannel,
    private diagnostics: vscode.DiagnosticCollection
  ) {}

  async scan(patterns: string[], maxDepth: number): Promise<BindingsMap> {
    this.bindingsMap.clear();
    this.processedFiles.clear();
    this.importedFunctions.clear();

    for (const pattern of patterns) {
      const files = await findFiles(pattern);
      for (const file of files) {
        await this.scanContainerFile(file.fsPath, 0, maxDepth);
      }
    }

    this.outputChannel.appendLine(
      `Found ${this.bindingsMap.size} bindings across ${this.processedFiles.size} files`
    );

    return this.bindingsMap;
  }

  private async scanContainerFile(filePath: string, depth: number, maxDepth: number) {
    if (this.processedFiles.has(filePath) || depth > maxDepth) {
      return;
    }

    this.processedFiles.add(filePath);

    const sourceFile = createSourceFile(filePath);
    if (!sourceFile) {
      return;
    }

    try {
      // Parse bindings in this file
      this.parseBindings(sourceFile, filePath);

      // Find and follow imported registry/configuration functions
      const importedModules = this.findImportedModules(sourceFile, filePath);
      
      // Find function calls that might configure sub-containers
      const functionCalls = this.findConfigurationFunctionCalls(sourceFile);

      // Scan imported modules that contain configuration functions
      for (const modulePath of importedModules) {
        if (functionCalls.size > 0) {
          await this.scanContainerFile(modulePath, depth + 1, maxDepth);
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
    
    for (const pattern of FILE_PATTERNS.registry) {
      const globPattern = path.join(dir, pattern).replace(/\\/g, '/');
      const foundFiles = await findFiles(vscode.workspace.asRelativePath(globPattern));
      files.push(...foundFiles.map(f => f.fsPath));
    }
    
    return [...new Set(files)];
  }

  private findImportedModules(sourceFile: ts.SourceFile, currentFilePath: string): string[] {
    const imports: string[] = [];

    ts.forEachChild(sourceFile, node => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          const importPath = moduleSpecifier.text;
          
          // Track imported functions for configuration detection
          if (node.importClause && node.importClause.namedBindings) {
            if (ts.isNamedImports(node.importClause.namedBindings)) {
              node.importClause.namedBindings.elements.forEach(element => {
                const name = element.name.getText(sourceFile);
                if (PATTERNS.configurationFunctions.some(pattern => name.includes(pattern))) {
                  this.importedFunctions.add(name);
                }
              });
            }
          }

          // Resolve relative imports
          const resolvedPath = resolveImportPath(importPath, currentFilePath);
          if (resolvedPath) {
            imports.push(resolvedPath);
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
        if (PATTERNS.configurationFunctions.some(pattern => text.includes(pattern)) ||
            this.importedFunctions.has(text)) {
          functionCalls.add(text);
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
          const existing = this.bindingsMap.get(binding.token) || [];
          existing.push(binding);
          this.bindingsMap.set(binding.token, existing);
          
          // Also map by implementation name for easier lookup
          const implBindings = this.bindingsMap.get(binding.implementation) || [];
          if (!implBindings.some(b => b.token === binding.token)) {
            implBindings.push(binding);
            this.bindingsMap.set(binding.implementation, implBindings);
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
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

    // Look for .to() in the chain
    let currentNode: ts.Node = node;
    let implementation: string | null = null;

    while (currentNode.parent) {
      if (ts.isPropertyAccessExpression(currentNode.parent)) {
        const propAccess = currentNode.parent;
        if (propAccess.name.getText(sourceFile) === 'to' && 
            propAccess.parent && 
            ts.isCallExpression(propAccess.parent)) {
          const toCall = propAccess.parent;
          if (toCall.arguments.length > 0) {
            implementation = extractIdentifier(toCall.arguments[0], sourceFile);
            break;
          }
        }
      } else if (ts.isCallExpression(currentNode.parent) && 
                 currentNode.parent.expression === currentNode) {
        // Continue up the chain
      } else {
        break;
      }
      currentNode = currentNode.parent;
    }

    // Also check for toSelf() pattern
    if (!implementation && currentNode.parent) {
      const parentText = currentNode.parent.getText(sourceFile);
      if (parentText.includes('.toSelf()')) {
        implementation = token; // Token is its own implementation
      }
    }

    if (token && implementation) {
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      this.outputChannel.appendLine(
        `Found binding: ${token} → ${implementation} in ${path.basename(filePath)}`
      );
      return {
        token,
        implementation,
        file: filePath,
        line: pos.line
      };
    }

    return null;
  }

  getProcessedFilesCount(): number {
    return this.processedFiles.size;
  }
}