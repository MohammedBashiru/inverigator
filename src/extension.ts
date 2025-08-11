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
    const config = vscode.workspace.getConfiguration('inverigator');
    const patterns = config.get<string[]>('containerPaths') || ['**/container.ts'];

    for (const pattern of patterns) {
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
      for (const file of files) {
        await this.scanContainerFile(file.fsPath);
      }
    }

    this.outputChannel.appendLine(`Found ${this.bindingsMap.size} bindings across ${patterns.length} container patterns`);
  }

  private async scanContainerFile(filePath: string) {
    try {
      if (!fs.existsSync(filePath)) {
        return;
      }

      const source = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true
      );

      this.parseBindings(sourceFile, filePath);
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

  private extractBinding(node: ts.CallExpression, sourceFile: ts.SourceFile, filePath: string): Binding | null {
    const text = node.expression.getText(sourceFile);
    
    // Check for container.bind pattern
    if (!text.includes('.bind')) {
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
        if (propAccess.name.getText(sourceFile) === 'to' && 
            propAccess.parent && 
            ts.isCallExpression(propAccess.parent)) {
          const toCall = propAccess.parent;
          if (toCall.arguments.length > 0) {
            implementation = this.extractIdentifier(toCall.arguments[0], sourceFile);
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

    if (token && implementation) {
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
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
    
    watcher.onDidChange(async (uri) => {
      const patterns = config.get<string[]>('containerPaths') || ['**/container.ts'];
      for (const pattern of patterns) {
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
        if (files.some(f => f.fsPath === uri.fsPath)) {
          this.outputChannel.appendLine(`Container file changed: ${uri.fsPath}`);
          await this.scanContainerFile(uri.fsPath);
          break;
        }
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
        .filter(key => key.includes(symbol))
        .flatMap(key => this.bindingsMap.get(key) || []);

      if (partialMatches.length === 0) {
        vscode.window.showErrorMessage(`No Inversify implementation found for: ${symbol}`);
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
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
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
      placeHolder: 'All InversifyJS bindings',
      matchOnDescription: true,
      matchOnDetail: true
    });
  }

  async rescan() {
    vscode.window.showInformationMessage('Rescanning container files...');
    await this.scanAllContainers();
    vscode.window.showInformationMessage(`Found ${this.bindingsMap.size} bindings`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Inverigator');
  const diagnostics = vscode.languages.createDiagnosticCollection('inverigator');
  
  context.subscriptions.push(outputChannel, diagnostics);
  
  const navigator = new InversifyNavigator(context, diagnostics, outputChannel);
  
  // Initialize the navigator
  navigator.initialize().then(() => {
    outputChannel.appendLine('Inverigator extension activated successfully');
  }).catch(error => {
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

  // Remove the hello world command as it's no longer needed
}

export function deactivate() {}