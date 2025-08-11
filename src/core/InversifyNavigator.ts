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
  private statusBarItem?: vscode.StatusBarItem;

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

  setStatusBarItem(statusBarItem: vscode.StatusBarItem) {
    this.statusBarItem = statusBarItem;
  }

  async initialize() {
    // Check if this is a fresh installation (no cache exists)
    const hasCachedData = await this.bindingScanner.hasCachedData();
    const config = vscode.workspace.getConfiguration('inverigator');
    const useCache = config.get<boolean>('useCache', true);
    
    // Always scan on first installation or when cache is disabled
    const shouldForceInitialScan = !hasCachedData || !useCache;
    
    if (shouldForceInitialScan) {
      this.outputChannel.appendLine('No cache found or cache disabled - performing initial scan');
    }
    
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Inverigator",
      cancellable: false
    }, async (progress) => {
      progress.report({ message: "Initializing InversifyJS navigation..." });
      await this.scanAll(progress, shouldForceInitialScan);
      this.setupFileWatchers();
      return;
    });
  }

  private async scanAll(progress?: vscode.Progress<{ message?: string; increment?: number }>, forceFullScan: boolean = false) {
    const config = vscode.workspace.getConfiguration('inverigator');
    const patterns = config.get<string[]>('containerPaths') || DEFAULT_CONFIG.containerPaths;
    const maxDepth = config.get<number>('maxScanDepth', DEFAULT_CONFIG.maxScanDepth);

    this.outputChannel.appendLine(`\n=== Starting ${forceFullScan ? 'Initial' : 'Full'} Scan ===`);
    this.outputChannel.appendLine(`Container patterns: ${patterns.join(', ')}`);
    this.outputChannel.appendLine(`Max scan depth: ${maxDepth}`);
    this.outputChannel.appendLine(`Force full scan: ${forceFullScan}`);

    // Scan for bindings (will use cache if available and not forcing full scan)
    if (progress) {
      progress.report({ message: "Scanning for InversifyJS bindings..." });
    }
    this.bindingsMap = await this.bindingScanner.scan(patterns, maxDepth, progress, forceFullScan);

    // Index services
    if (progress) {
      progress.report({ message: "Indexing service classes..." });
    }
    this.serviceMap = await this.serviceIndexer.indexServices(progress);

    // Map injections (interfaces to tokens)
    if (progress) {
      progress.report({ message: "Mapping dependency injections..." });
    }
    await this.injectionMapper.mapInjections(progress);

    // Update navigator with new data
    this.navigator = new Navigator(this.outputChannel, this.bindingsMap, this.serviceMap, this.injectionMapper);

    this.outputChannel.appendLine(
      `${EXTENSION_NAME} initialization complete: ${this.getBindingsCount()} bindings, ${this.serviceMap.size} services`
    );

    // Update status bar if available
    if (this.statusBarItem) {
      const bindingCount = this.getBindingsCount();
      this.statusBarItem.text = `$(check) Inverigator: ${bindingCount} bindings`;
      this.statusBarItem.tooltip = `InversifyJS: ${bindingCount} bindings found\nClick to show all bindings`;
      this.statusBarItem.command = 'inverigator.showBindings';
    }
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
    const shouldRescan = keywords.some(keyword => filePath.includes(keyword));
    
    // Invalidate cache if we're rescanning due to file changes
    if (shouldRescan) {
      this.invalidateCache([filePath]);
    }
    
    return shouldRescan;
  }
  
  private async invalidateCache(files?: string[]) {
    await this.bindingScanner.clearCache();
    this.outputChannel.appendLine('Cache invalidated due to file changes');
  }

  async goToImplementation() {
    await this.navigator.goToImplementation();
  }

  async goToImplementationForToken(token: string) {
    await this.navigator.goToImplementationForToken(token);
  }

  async getImplementationLocation(token: string): Promise<{ file: string; line: number } | undefined> {
    return await this.navigator.getImplementationLocation(token);
  }

  async getInjectionInfoForProperty(propertyName: string) {
    return this.injectionMapper.getInjectionInfoForProperty(propertyName);
  }

  async goToMethod(serviceName: string, methodName: string) {
    await this.navigator.goToMethod(serviceName, methodName);
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
    // Clear cache before rescanning
    await this.bindingScanner.clearCache();
    
    // Update status bar to show scanning
    if (this.statusBarItem) {
      this.statusBarItem.text = '$(sync~spin) Inverigator: Rescanning...';
      this.statusBarItem.tooltip = 'Rescanning for InversifyJS bindings';
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Inverigator",
      cancellable: false
    }, async (progress) => {
      progress.report({ message: "Rescanning container files..." });
      await this.scanAll(progress);
      vscode.window.showInformationMessage(
        `Found ${this.getBindingsCount()} bindings and ${this.serviceMap.size} services`
      );
      return;
    });
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
  
  async getCacheStats() {
    return await this.bindingScanner.getCacheStats();
  }
  
  async showCacheStats() {
    const stats = await this.bindingScanner.getCacheStats();
    if (stats.exists) {
      const ageInMinutes = Math.round((stats.age || 0) / 60000);
      const sizeInKB = Math.round((stats.size || 0) / 1024);
      vscode.window.showInformationMessage(
        `Cache: ${stats.bindingsCount} bindings, ${stats.injectionsCount} injections, ${sizeInKB}KB, ${ageInMinutes}min old`
      );
    } else {
      vscode.window.showInformationMessage('No cache exists. Run a scan to create cache.');
    }
  }
  
  async clearCache() {
    await this.bindingScanner.clearCache();
    vscode.window.showInformationMessage('Cache cleared. Next scan will rebuild the cache.');
  }

  dispose() {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
  }
}