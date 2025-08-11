import * as vscode from 'vscode';
import { BindingsMap, ServiceMap } from '../types';
import { DEFAULT_CONFIG, EXTENSION_NAME } from '../constants';
import { BindingScanner } from '../services/BindingScanner';
import { ServiceIndexer } from '../services/ServiceIndexer';
import { Navigator } from '../services/Navigator';
import { InjectionMapper } from '../services/InjectionMapper';

export class InversifyNavigator {
  private bindingsMap: BindingsMap = new Map();
  private serviceMap: ServiceMap = new Map();
  private bindingScanner: BindingScanner;
  private serviceIndexer: ServiceIndexer;
  private injectionMapper: InjectionMapper;
  private navigator: Navigator;
  private fileWatcher?: vscode.FileSystemWatcher;

  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.OutputChannel,
    private diagnostics: vscode.DiagnosticCollection
  ) {
    this.bindingScanner = new BindingScanner(outputChannel, diagnostics);
    this.serviceIndexer = new ServiceIndexer(outputChannel);
    this.injectionMapper = new InjectionMapper(outputChannel);
    this.navigator = new Navigator(outputChannel, this.bindingsMap, this.serviceMap, this.injectionMapper);
  }

  async initialize() {
    await this.scanAll();
    this.setupFileWatchers();
  }

  private async scanAll() {
    const config = vscode.workspace.getConfiguration('inverigator');
    const patterns = config.get<string[]>('containerPaths') || DEFAULT_CONFIG.containerPaths;
    const maxDepth = config.get<number>('maxScanDepth', DEFAULT_CONFIG.maxScanDepth);

    this.outputChannel.appendLine(`\n=== Starting Full Scan ===`);
    this.outputChannel.appendLine(`Container patterns: ${patterns.join(', ')}`);
    this.outputChannel.appendLine(`Max scan depth: ${maxDepth}`);

    // Scan for bindings
    this.bindingsMap = await this.bindingScanner.scan(patterns, maxDepth);

    // Index services
    this.serviceMap = await this.serviceIndexer.indexServices();

    // Map injections (interfaces to tokens)
    await this.injectionMapper.mapInjections();

    // Update navigator with new data
    this.navigator = new Navigator(this.outputChannel, this.bindingsMap, this.serviceMap, this.injectionMapper);

    this.outputChannel.appendLine(
      `${EXTENSION_NAME} initialization complete: ${this.getBindingsCount()} bindings, ${this.serviceMap.size} services`
    );
  }

  private setupFileWatchers() {
    const config = vscode.workspace.getConfiguration('inverigator');
    const autoScan = config.get<boolean>('autoScanOnSave', DEFAULT_CONFIG.autoScanOnSave);

    if (!autoScan) {
      return;
    }

    // Dispose existing watcher if any
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }

    this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,js}');
    
    this.fileWatcher.onDidChange(async (uri) => {
      // Check if this file might contain bindings or services
      if (this.shouldRescan(uri.fsPath)) {
        this.outputChannel.appendLine(`File changed: ${uri.fsPath}, rescanning...`);
        await this.scanAll();
      }
    });

    this.context.subscriptions.push(this.fileWatcher);
  }

  private shouldRescan(filePath: string): boolean {
    const keywords = ['registry', 'Registry', 'container', 'Container', 'bindings', 'Bindings'];
    return keywords.some(keyword => filePath.includes(keyword));
  }

  async goToImplementation() {
    await this.navigator.goToImplementation();
  }

  async showBindings() {
    await this.navigator.showBindings();
  }

  async showInjections() {
    const items: vscode.QuickPickItem[] = [];
    const mappings = this.injectionMapper.getAllMappings();
    
    mappings.forEach((token, interfaceName) => {
      items.push({
        label: `${interfaceName} → ${token}`,
        description: 'Interface to Token mapping',
        detail: `Interface ${interfaceName} is injected with ${token}`
      });
    });

    if (items.length === 0) {
      vscode.window.showInformationMessage('No injection mappings found.');
      return;
    }

    await vscode.window.showQuickPick(items, {
      placeHolder: `All injection mappings (${items.length} total)`,
      matchOnDescription: true,
      matchOnDetail: true
    });
  }

  async rescan() {
    vscode.window.showInformationMessage('Rescanning container files...');
    await this.scanAll();
    vscode.window.showInformationMessage(
      `Found ${this.getBindingsCount()} bindings and ${this.serviceMap.size} services`
    );
  }

  getBindingsCount(): number {
    // Count unique token->implementation pairs
    const uniqueBindings = new Set<string>();
    this.bindingsMap.forEach(bindings => {
      bindings.forEach(b => {
        uniqueBindings.add(`${b.token}→${b.implementation}`);
      });
    });
    return uniqueBindings.size;
  }

  getProcessedFilesCount(): number {
    return this.bindingScanner.getProcessedFilesCount();
  }

  dispose() {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
  }
}