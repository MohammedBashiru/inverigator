import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

interface Binding {
  token: string;
  implementation: string;
  file: string;
  line: number;
}

class InversifyNavigator {
  private bindingsMap: Map<string, Binding[]> = new Map();
  private diagnostics: vscode.DiagnosticCollection;
  private outputChannel: vscode.OutputChannel;
  private processedFiles: Set<string> = new Set();
  private importedFunctions: Set<string> = new Set();

  constructor(
    private context: vscode.ExtensionContext,
    diagnostics: vscode.DiagnosticCollection,
    outputChannel: vscode.OutputChannel
  ) {
    this.diagnostics = diagnostics;
    this.outputChannel = outputChannel;
  }

  async initialize() {
    await this.scanAllContainers();
    this.setupFileWatchers();
  }

  private async scanAllContainers() {
    this.bindingsMap.clear();
    this.processedFiles.clear();
    this.importedFunctions.clear();

    const config = vscode.workspace.getConfiguration('inverigator');
    const patterns = config.get<string[]>('containerPaths') || ['**/container.ts'];
    const scanDepth = config.get<number>('maxScanDepth', 5);

    for (const pattern of patterns) {
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
      for (const file of files) {
        await this.scanContainerFile(file.fsPath, 0, scanDepth);
      }
    }

    this.outputChannel.appendLine(
      `Found ${this.bindingsMap.size} bindings across ${this.processedFiles.size} files`
    );
  }

  private async scanContainerFile(filePath: string, depth: number, maxDepth: number) {
    if (this.processedFiles.has(filePath) || depth > maxDepth) {
      return;
    }

    this.processedFiles.add(filePath);

    try {
      if (!fs.existsSync(filePath)) {
        return;
      }

      const source = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

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
    const patterns = [
      path.join(dir, '**/*registry*.ts'),
      path.join(dir, '**/*Registry*.ts'),
      path.join(dir, '**/*bindings*.ts'),
      path.join(dir, '**/*Bindings*.ts'),
      path.join(dir, '**/*container*.ts'),
      path.join(dir, '**/*Container*.ts')
    ];

    const files: string[] = [];
    for (const pattern of patterns) {
      const globPattern = pattern.replace(/\\/g, '/');
      const foundFiles = await vscode.workspace.findFiles(
        vscode.workspace.asRelativePath(globPattern),
        '**/node_modules/**'
      );
      files.push(...foundFiles.map(f => f.fsPath));
    }

    return [...new Set(files)];
  }

  private findImportedModules(sourceFile: ts.SourceFile, currentFilePath: string): string[] {
    const imports: string[] = [];
    const dir = path.dirname(currentFilePath);

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
                if (name.includes('Registry') || name.includes('Configure')) {
                  this.importedFunctions.add(name);
                }
              });
            }
          }

          // Resolve relative imports
          if (importPath.startsWith('.')) {
            const resolvedPath = path.resolve(dir, importPath);
            // Try different extensions
            const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
            for (const ext of extensions) {
              const fullPath =
                resolvedPath.endsWith('.ts') || resolvedPath.endsWith('.js')
                  ? resolvedPath
                  : resolvedPath + ext;
              if (fs.existsSync(fullPath)) {
                imports.push(fullPath);
                break;
              }
            }
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
        if (
          text.includes('Configure') ||
          text.includes('Registry') ||
          text.includes('register') ||
          text.includes('Bind') ||
          this.importedFunctions.has(text)
        ) {
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
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  private extractBinding(
    node: ts.CallExpression,
    sourceFile: ts.SourceFile,
    filePath: string
  ): Binding | null {
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
    let token = this.extractIdentifier(tokenArg, sourceFile);

    // Look for .to() in the chain
    let currentNode: ts.Node = node;
    let implementation: string | null = null;

    while (currentNode.parent) {
      if (ts.isPropertyAccessExpression(currentNode.parent)) {
        const propAccess = currentNode.parent;
        if (
          propAccess.name.getText(sourceFile) === 'to' &&
          propAccess.parent &&
          ts.isCallExpression(propAccess.parent)
        ) {
          const toCall = propAccess.parent;
          if (toCall.arguments.length > 0) {
            implementation = this.extractIdentifier(toCall.arguments[0], sourceFile);
            break;
          }
        }
      } else if (
        ts.isCallExpression(currentNode.parent) &&
        currentNode.parent.expression === currentNode
      ) {
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

  private extractIdentifier(node: ts.Node, sourceFile: ts.SourceFile): string {
    const text = node.getText(sourceFile);

    // Remove quotes if it's a string literal
    if (text.startsWith('"') || text.startsWith("'") || text.startsWith('`')) {
      return text.slice(1, -1);
    }

    // Handle Symbol() calls
    if (text.startsWith('Symbol(') || text.startsWith('Symbol.for(')) {
      const match = text.match(/Symbol(?:\.for)?\(['"`](.+?)['"`]\)/);
      return match ? match[1] : text;
    }

    return text;
  }

  private setupFileWatchers() {
    const config = vscode.workspace.getConfiguration('inverigator');
    const autoScan = config.get<boolean>('autoScanOnSave', true);

    if (!autoScan) {
      return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,js}');

    watcher.onDidChange(async uri => {
      // Check if this file is in our processed files or matches patterns
      if (
        this.processedFiles.has(uri.fsPath) ||
        uri.fsPath.includes('registry') ||
        uri.fsPath.includes('Registry') ||
        uri.fsPath.includes('container') ||
        uri.fsPath.includes('Container')
      ) {
        this.outputChannel.appendLine(`Related file changed: ${uri.fsPath}`);
        // Rescan all containers as bindings might have changed
        await this.scanAllContainers();
      }
    });

    this.context.subscriptions.push(watcher);
  }

  async goToImplementation() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor');
      return;
    }

    const position = editor.selection.active;
    const wordRange = editor.document.getWordRangeAtPosition(position);
    if (!wordRange) {
      vscode.window.showErrorMessage('No symbol selected');
      return;
    }

    const symbol = editor.document.getText(wordRange);
    const bindings = this.bindingsMap.get(symbol);

    if (!bindings || bindings.length === 0) {
      // Try to find partial matches
      const partialMatches = Array.from(this.bindingsMap.keys())
        .filter(key => key.includes(symbol) || symbol.includes(key))
        .flatMap(key => this.bindingsMap.get(key) || []);

      if (partialMatches.length === 0) {
        vscode.window.showErrorMessage(`No Inversify implementation found for: ${symbol}`);
        this.outputChannel.appendLine(`No binding found for: ${symbol}`);
        this.outputChannel.appendLine(
          `Available bindings: ${Array.from(this.bindingsMap.keys()).join(', ')}`
        );
        return;
      }

      await this.handleBindings(partialMatches, symbol);
    } else {
      await this.handleBindings(bindings, symbol);
    }
  }

  private async handleBindings(bindings: Binding[], symbol: string) {
    if (bindings.length === 1) {
      await this.navigateToImplementation(bindings[0]);
    } else {
      // Multiple bindings, let user choose
      const items = bindings.map(b => ({
        label: b.implementation,
        description: path.basename(b.file),
        detail: `Line ${b.line + 1} in ${b.file}`,
        binding: b
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Multiple implementations found for ${symbol}`
      });

      if (selected) {
        await this.navigateToImplementation(selected.binding);
      }
    }
  }

  private async navigateToImplementation(binding: Binding) {
    // First, try to find the implementation file
    const implName = binding.implementation;

    // Search patterns for the implementation
    const searchPatterns = [
      `**/${implName}.ts`,
      `**/${implName}.js`,
      `**/${implName}.tsx`,
      `**/${implName}.jsx`,
      `**/${implName.charAt(0).toLowerCase() + implName.slice(1)}.ts`,
      `**/${this.camelToKebab(implName)}.ts`,
      `**/${this.camelToSnake(implName)}.ts`
    ];

    let foundFiles: vscode.Uri[] = [];
    for (const pattern of searchPatterns) {
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
      foundFiles.push(...files);
      if (foundFiles.length > 0) {
        break;
      }
    }

    if (foundFiles.length === 0) {
      // Try to search for the class/interface definition in all TypeScript files
      const allTsFiles = await vscode.workspace.findFiles('**/*.{ts,tsx}', '**/node_modules/**');

      for (const file of allTsFiles) {
        const content = fs.readFileSync(file.fsPath, 'utf-8');
        const classRegex = new RegExp(`(?:export\\s+)?(?:class|interface)\\s+${implName}\\b`);
        if (classRegex.test(content)) {
          foundFiles.push(file);
        }
      }
    }

    if (foundFiles.length === 0) {
      vscode.window.showErrorMessage(`Implementation file not found for: ${implName}`);
      this.outputChannel.appendLine(`Could not find implementation for ${implName}`);
      return;
    }

    if (foundFiles.length === 1) {
      await this.openFileAndNavigate(foundFiles[0], implName);
    } else {
      // Multiple files found, let user choose
      const items = foundFiles.map(f => ({
        label: path.basename(f.fsPath),
        description: vscode.workspace.asRelativePath(f.fsPath),
        uri: f
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Multiple files found for ${implName}`
      });

      if (selected) {
        await this.openFileAndNavigate(selected.uri, implName);
      }
    }
  }

  private async openFileAndNavigate(uri: vscode.Uri, className: string) {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    // Try to find the class/interface definition and jump to it
    const text = document.getText();
    const classRegex = new RegExp(`(?:export\\s+)?(?:class|interface)\\s+${className}\\b`);
    const match = classRegex.exec(text);

    if (match) {
      const position = document.positionAt(match.index!);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    }
  }

  private camelToKebab(str: string): string {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
  }

  private camelToSnake(str: string): string {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1_$2').toLowerCase();
  }

  async showBindings() {
    const items: vscode.QuickPickItem[] = [];

    this.bindingsMap.forEach((bindings, token) => {
      bindings.forEach(binding => {
        items.push({
          label: `${token} → ${binding.implementation}`,
          description: path.basename(binding.file),
          detail: `Line ${binding.line + 1}`
        });
      });
    });

    if (items.length === 0) {
      vscode.window.showInformationMessage('No bindings found. Try rescanning container files.');
      return;
    }

    await vscode.window.showQuickPick(items, {
      placeHolder: `All InversifyJS bindings (${items.length} total)`,
      matchOnDescription: true,
      matchOnDetail: true
    });
  }

  async rescan() {
    vscode.window.showInformationMessage('Re-scanning container files...');
    await this.scanAllContainers();
    vscode.window.showInformationMessage(`Found ${this.bindingsMap.size} bindings`);
  }

  getBindingsCount(): number {
    return this.bindingsMap.size;
  }

  getProcessedFilesCount(): number {
    return this.processedFiles.size;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Inverigator');
  const diagnostics = vscode.languages.createDiagnosticCollection('inverigator');

  context.subscriptions.push(outputChannel, diagnostics);

  const navigator = new InversifyNavigator(context, diagnostics, outputChannel);

  // Initialize the navigator
  navigator
    .initialize()
    .then(() => {
      outputChannel.appendLine('Inverigator extension activated successfully');
      outputChannel.appendLine(`Scanned ${navigator.getProcessedFilesCount()} files`);
      outputChannel.appendLine(`Found ${navigator.getBindingsCount()} bindings`);
    })
    .catch(error => {
      outputChannel.appendLine(`Failed to initialize: ${error}`);
      vscode.window.showErrorMessage(`Inverigator failed to initialize: ${error}`);
    });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('inversifyNavigator.goToImplementation', () => {
      navigator.goToImplementation();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('inverigator.showBindings', () => {
      navigator.showBindings();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('inverigator.rescan', () => {
      navigator.rescan();
    })
  );
}

export function deactivate() {}
