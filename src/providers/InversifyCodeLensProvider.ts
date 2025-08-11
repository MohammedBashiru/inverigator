import * as vscode from 'vscode';
import { InversifyNavigator } from '../core/InversifyNavigator';
import { InjectedPropertyTracker } from '../services/InjectedPropertyTracker';
import { shouldProcessIdentifier } from '../utils/identifierFilter';

export class InversifyCodeLensProvider implements vscode.CodeLensProvider {
  private propertyTracker: InjectedPropertyTracker;
  
  constructor(private navigator: InversifyNavigator) {
    const outputChannel = vscode.window.createOutputChannel('Inverigator-CodeLens', { log: true });
    this.propertyTracker = new InjectedPropertyTracker(outputChannel);
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    
    // Check if CodeLens is enabled
    const config = vscode.workspace.getConfiguration('inverigator');
    if (!config.get<boolean>('enableCodeLens', true)) {
      return codeLenses;
    }
    
    // Only process TypeScript files
    if (document.languageId !== 'typescript' && document.languageId !== 'javascript') {
      return codeLenses;
    }

    const text = document.getText();
    
    // Look for @inject decorators
    const injectPattern = /@inject\s*\(\s*([^)]+)\s*\)/g;
    let match;
    
    while ((match = injectPattern.exec(text)) !== null) {
      const token = match[1].trim();
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);
      
      const location = await this.navigator.getImplementationLocation(token);
      if (location) {
        const lens = new vscode.CodeLens(range, {
          title: '→ Go to Implementation',
          tooltip: `Navigate to ${token} implementation`,
          command: 'inverigator.goToImplementationWithToken',
          arguments: [token]
        });
        codeLenses.push(lens);
      }
    }
    
    // Look for container.bind patterns
    const bindPattern = /\.bind(?:<[^>]+>)?\s*\(\s*([^)]+)\s*\)/g;
    
    while ((match = bindPattern.exec(text)) !== null) {
      const token = match[1].trim();
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);
      
      const location = await this.navigator.getImplementationLocation(token);
      if (location) {
        const lens = new vscode.CodeLens(range, {
          title: '→ View Implementation',
          tooltip: `View ${token} implementation`,
          command: 'inverigator.goToImplementationWithToken',
          arguments: [token]
        });
        codeLenses.push(lens);
      }
    }
    
    // Look for this.service.method() patterns
    const thisServicePattern = /this\.([a-zA-Z0-9_]+)\.(\w+)\s*\(/g;
    const processedLines = new Set<number>();
    
    while ((match = thisServicePattern.exec(text)) !== null) {
      const serviceName = match[1];
      const methodName = match[2];
      const startPos = document.positionAt(match.index);
      
      // Only add one CodeLens per line
      if (processedLines.has(startPos.line)) {
        continue;
      }
      processedLines.add(startPos.line);
      
      // Skip if this is a built-in method
      if (!shouldProcessIdentifier(methodName)) {
        continue;
      }
      
      // Get the class context for this position
      const className = this.propertyTracker.getClassNameAtPosition(document, startPos);
      if (!className) {
        continue;
      }
      
      // Check if this property is actually injected
      const isInjected = this.propertyTracker.isInjectedProperty(
        document.fileName,
        className,
        serviceName
      );
      
      if (!isInjected) {
        // Not an injected service, skip it
        continue;
      }
      
      // Check if we can find this service
      const injectionInfo = await this.navigator.getInjectionInfoForProperty(serviceName);
      if (injectionInfo) {
        const range = new vscode.Range(startPos, startPos);
        const lens = new vscode.CodeLens(range, {
          title: `→ Go to ${serviceName}.${methodName}()`,
          tooltip: `Navigate to ${methodName} method in ${serviceName}`,
          command: 'inverigator.goToMethod',
          arguments: [serviceName, methodName]
        });
        codeLenses.push(lens);
      }
    }
    
    return codeLenses;
  }

  resolveCodeLens?(
    codeLens: vscode.CodeLens,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens> {
    // CodeLens is already resolved in provideCodeLenses
    return codeLens;
  }
}