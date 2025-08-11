import * as vscode from 'vscode';
import * as path from 'path';
import { Binding, BindingsMap, ServiceMap } from '../types';
import { searchForClass } from '../utils/fileUtils';
import { InjectionMapper } from './InjectionMapper';

export class Navigator {
  constructor(
    private outputChannel: vscode.OutputChannel,
    private bindingsMap: BindingsMap,
    private serviceMap: ServiceMap,
    private injectionMapper?: InjectionMapper
  ) {}

  setInjectionMapper(mapper: InjectionMapper) {
    this.injectionMapper = mapper;
  }

  async goToImplementationForToken(token: string) {
    this.outputChannel.appendLine(`\n=== Navigation Request (from CodeLens) ===`);
    this.outputChannel.appendLine(`Looking for token: '${token}'`);
    
    // First, check if this is an interface that maps to a token
    if (this.injectionMapper && token.startsWith('I')) {
      const mappedToken = this.injectionMapper.getTokenForInterface(token);
      if (mappedToken) {
        this.outputChannel.appendLine(`Interface ${token} maps to token ${mappedToken}`);
        token = mappedToken;
      }
    }
    
    // Look for direct token binding
    const bindings = this.bindingsMap.get(token);
    if (bindings && bindings.length > 0) {
      await this.handleBindings(bindings, token);
      return;
    }
    
    // Also check if token is itself an implementation class name
    const serviceInfo = this.serviceMap.get(token);
    if (serviceInfo) {
      await this.openFileAndNavigate(vscode.Uri.file(serviceInfo.file), token);
      return;
    }
    
    vscode.window.showErrorMessage(`No implementation found for: ${token}`);
  }

  async goToImplementation() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor');
      return;
    }

    const position = editor.selection.active;
    const document = editor.document;
    
    // Get the full line context to understand what we're navigating
    const line = document.lineAt(position.line);
    const currentLineText = line.text;
    
    // Check if we're on a method call (e.g., this.service.method())
    const methodCallRegex = /(\w+)\.(\w+)\s*\(/;
    const methodMatch = methodCallRegex.exec(currentLineText);
    
    if (methodMatch && position.character >= currentLineText.indexOf(methodMatch[0])) {
      const serviceName = methodMatch[1];
      const methodName = methodMatch[2];
      
      // Try to navigate to the method
      if (await this.navigateToMethod(serviceName, methodName, document)) {
        return;
      }
    }
    
    // Regular word-based navigation
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      vscode.window.showErrorMessage('No symbol selected');
      return;
    }

    const symbol = document.getText(wordRange);
    
    // Log what symbol we're looking for
    this.outputChannel.appendLine(`\n=== Navigation Request ===`);
    this.outputChannel.appendLine(`Looking for symbol: '${symbol}'`);
    this.outputChannel.appendLine(`Cursor position: Line ${position.line + 1}, Column ${position.character}`);
    this.outputChannel.appendLine(`Total bindings in map: ${this.bindingsMap.size}`);
    
    // Log if this is property navigation vs direct token navigation
    const isDirectToken = symbol.includes('TYPES') || symbol.match(/^[A-Z_]+$/);
    this.outputChannel.appendLine(`Navigation type: ${isDirectToken ? 'Direct token' : 'Property/Interface'}`);
    
    // First, check if this is an interface that maps to a token
    if (this.injectionMapper && symbol.startsWith('I')) {
      const token = this.injectionMapper.getTokenForInterface(symbol);
      if (token) {
        this.outputChannel.appendLine(`Interface ${symbol} maps to token ${token}`);
        // Look up the binding for this token
        const tokenBindings = this.bindingsMap.get(token);
        if (tokenBindings && tokenBindings.length > 0) {
          await this.handleBindings(tokenBindings, symbol);
          return;
        }
      }
    }
    
    // Check if the symbol itself might be a property name that's injected
    // This handles both "this.propertyName" and just "propertyName" cases
    const lineText = document.lineAt(position.line).text;
    const isPropertyAccess = lineText.includes(`this.${symbol}`) || lineText.includes(`.${symbol}`);
    
    if (isPropertyAccess || symbol.match(/^[a-z]/)) { // Properties typically start with lowercase
      this.outputChannel.appendLine(`Checking if '${symbol}' is an injected property...`);
      
      // First check if we have pre-scanned injection info
      if (this.injectionMapper) {
        const injectionInfo = this.injectionMapper.getInjectionInfoForProperty(symbol);
        if (injectionInfo) {
          this.outputChannel.appendLine(`Property ${symbol} has injection info: ${injectionInfo.token}`);
          const tokenBindings = this.bindingsMap.get(injectionInfo.token);
          if (tokenBindings && tokenBindings.length > 0) {
            await this.handleBindings(tokenBindings, symbol);
            return;
          }
        }
      }
      
      // If not found in pre-scan, try to find it in current file's constructor
      const fileText = document.getText();
      const injectionToken = this.findInjectionTokenForProperty(symbol, fileText);
      if (injectionToken) {
        this.outputChannel.appendLine(`Found injection token for ${symbol}: ${injectionToken}`);
        
        // Try exact match first
        let tokenBindings = this.bindingsMap.get(injectionToken);
        
        // If no exact match, check if the token exists with a different case or format
        if (!tokenBindings || tokenBindings.length === 0) {
          this.outputChannel.appendLine(`No exact match for token '${injectionToken}', checking all keys...`);
          
          // Log all available keys for debugging
          const allKeys = Array.from(this.bindingsMap.keys());
          this.outputChannel.appendLine(`Available binding keys (${allKeys.length} total): ${allKeys.slice(0, 10).join(', ')}...`);
          
          // Check if TYPES.TravelTourRegistrationService exists
          const exactKey = allKeys.find(key => key === injectionToken);
          if (exactKey) {
            this.outputChannel.appendLine(`Found exact key match: ${exactKey}`);
            tokenBindings = this.bindingsMap.get(exactKey);
          } else {
            // Try to find a matching key
            const matchingKey = allKeys.find(key => {
              // Check if the key ends with the same identifier
              const tokenParts = injectionToken.split('.');
              const keyParts = key.split('.');
              
              if (tokenParts.length > 0 && keyParts.length > 0) {
                const tokenEnd = tokenParts[tokenParts.length - 1];
                const keyEnd = keyParts[keyParts.length - 1];
                return tokenEnd === keyEnd;
              }
              
              return key === injectionToken || key.includes(injectionToken) || injectionToken.includes(key);
            });
            
            if (matchingKey) {
              this.outputChannel.appendLine(`Found matching key: ${matchingKey}`);
              tokenBindings = this.bindingsMap.get(matchingKey);
            }
          }
        }
        
        if (tokenBindings && tokenBindings.length > 0) {
          this.outputChannel.appendLine(`Found ${tokenBindings.length} bindings for token`);
          await this.handleBindings(tokenBindings, symbol);
          return;
        } else {
          this.outputChannel.appendLine(`No bindings found for token ${injectionToken}`);
          // Debug: Let's see what the binding map actually contains for this token
          this.outputChannel.appendLine(`Debug: Checking bindingsMap.has('${injectionToken}') = ${this.bindingsMap.has(injectionToken)}`);
          if (this.bindingsMap.has('TYPES.TravelTourRegistrationService')) {
            const bindings = this.bindingsMap.get('TYPES.TravelTourRegistrationService');
            this.outputChannel.appendLine(`Debug: TYPES.TravelTourRegistrationService exists with ${bindings?.length} bindings`);
          }
        }
      }
    }
    
    // Try direct binding lookup
    let bindings = this.bindingsMap.get(symbol);
    this.outputChannel.appendLine(`Direct lookup for '${symbol}': ${bindings?.length || 0} bindings found`);

    // If no direct match, try to find by implementation name
    if (!bindings || bindings.length === 0) {
      // Check if this is a service class name
      const serviceInfo = this.serviceMap.get(symbol);
      if (serviceInfo) {
        // Navigate directly to the service implementation
        await this.openFileAndNavigate(vscode.Uri.file(serviceInfo.file), symbol);
        return;
      }

      // Try to find partial matches or by class name
      const partialMatches = Array.from(this.bindingsMap.entries())
        .filter(([key, _]) => {
          return key === symbol || 
                 key.includes(symbol) || 
                 symbol.includes(key) ||
                 (key.endsWith('Service') && symbol.endsWith('Service')) ||
                 key.replace(/Service$/, '') === symbol.replace(/Service$/, '');
        })
        .flatMap(([_, bindings]) => bindings);

      if (partialMatches.length === 0) {
        vscode.window.showErrorMessage(`No Inversify implementation found for: ${symbol}`);
        this.outputChannel.appendLine(`No binding found for: ${symbol}`);
        this.outputChannel.appendLine(`Available bindings: ${Array.from(this.bindingsMap.keys()).join(', ')}`);
        return;
      }

      await this.handleBindings(partialMatches, symbol);
    } else {
      await this.handleBindings(bindings, symbol);
    }
  }

  private findInjectionTokenForProperty(propertyName: string, fileText: string): string | null {
    // Look for constructor injection pattern
    // Example: @inject(TYPES.TravelTourRegistrationService) private travelTourService: ITravelTourRegistrationService
    const constructorRegex = new RegExp(
      `@inject\\s*\\(([^)]+)\\)\\s+(?:private|public|protected)?\\s+${propertyName}\\s*:`,
      'g'
    );
    
    const match = constructorRegex.exec(fileText);
    if (match) {
      return match[1].trim();
    }
    
    // Also check for property injection pattern
    const propertyRegex = new RegExp(
      `@inject\\s*\\(([^)]+)\\)[^;]*${propertyName}\\s*:`,
      'g'
    );
    
    const propMatch = propertyRegex.exec(fileText);
    if (propMatch) {
      return propMatch[1].trim();
    }
    
    return null;
  }

  private async navigateToMethod(
    serviceName: string, 
    methodName: string, 
    document: vscode.TextDocument
  ): Promise<boolean> {
    // Find the service type from the current file's context
    const text = document.getText();
    const serviceTypeRegex = new RegExp(`private\\s+${serviceName}\\s*:\\s*(\\w+)`);
    const match = serviceTypeRegex.exec(text);
    
    if (match) {
      const serviceType = match[1];
      const serviceInfo = this.serviceMap.get(serviceType);
      
      if (serviceInfo) {
        const doc = await vscode.workspace.openTextDocument(serviceInfo.file);
        const editor = await vscode.window.showTextDocument(doc);
        
        // Find the method in the file
        const fileText = doc.getText();
        const methodRegex = new RegExp(`\\b${methodName}\\s*\\(`);
        const methodMatch = methodRegex.exec(fileText);
        
        if (methodMatch) {
          const position = doc.positionAt(methodMatch.index!);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position), 
            vscode.TextEditorRevealType.InCenter
          );
          return true;
        }
      }
    }
    
    return false;
  }

  private async handleBindings(bindings: Binding[], symbol: string) {
    if (bindings.length === 1) {
      await this.navigateToImplementation(bindings[0]);
    } else {
      // Multiple bindings, let user choose
      const items = bindings.map(b => ({
        label: b.implementation,
        description: `${b.token} → ${b.implementation}`,
        detail: `Line ${b.line + 1} in ${path.basename(b.file)}`,
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
    const implName = binding.implementation;
    
    // Check if we already have this in our service map
    const serviceInfo = this.serviceMap.get(implName);
    if (serviceInfo) {
      await this.openFileAndNavigate(vscode.Uri.file(serviceInfo.file), implName);
      return;
    }
    
    // Search for the implementation file
    const foundFiles = await searchForClass(implName);

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

  async getImplementationLocation(token: string): Promise<{ file: string; line: number } | undefined> {
    this.outputChannel.appendLine(`Looking for implementation of token: ${token}`);
    
    // First, check if this is an interface that maps to a token
    if (this.injectionMapper && token.startsWith('I')) {
      const mappedToken = this.injectionMapper.getTokenForInterface(token);
      if (mappedToken) {
        token = mappedToken;
        this.outputChannel.appendLine(`Interface ${token} maps to token ${mappedToken}`);
      }
    }
    
    // Look for direct token binding
    const bindings = this.bindingsMap.get(token);
    if (bindings && bindings.length > 0) {
      const binding = bindings[0]; // Return first binding for Alt+Click
      
      // Try to find the implementation class file
      const implName = binding.implementation;
      const serviceInfo = this.serviceMap.get(implName);
      
      if (serviceInfo) {
        return { file: serviceInfo.file, line: 0 };
      }
      
      // If not in service map, try to search for it
      const foundFiles = await searchForClass(implName);
      if (foundFiles.length > 0) {
        return { file: foundFiles[0].fsPath, line: 0 };
      }
    }
    
    // Also check if token is itself an implementation class name
    const serviceInfo = this.serviceMap.get(token);
    if (serviceInfo) {
      return { file: serviceInfo.file, line: 0 };
    }
    
    return undefined;
  }

  async showBindings() {
    const items: vscode.QuickPickItem[] = [];
    const addedBindings = new Set<string>();
    
    this.bindingsMap.forEach((bindings) => {
      bindings.forEach(binding => {
        const key = `${binding.token} → ${binding.implementation}`;
        if (!addedBindings.has(key)) {
          addedBindings.add(key);
          items.push({
            label: key,
            description: path.basename(binding.file),
            detail: `Line ${binding.line + 1}`
          });
        }
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
}