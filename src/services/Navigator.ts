import * as vscode from 'vscode';
import * as fs from 'fs';
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
    
    // Check if we're on a property that has injection info
    const lineText = document.lineAt(position.line).text;
    const propertyMatch = lineText.match(/this\.(\w+)/);
    if (propertyMatch && this.injectionMapper) {
      const propertyName = propertyMatch[1];
      const injectionInfo = this.injectionMapper.getInjectionInfoForProperty(propertyName);
      if (injectionInfo) {
        this.outputChannel.appendLine(`Property ${propertyName} has injection info: ${injectionInfo.token}`);
        const tokenBindings = this.bindingsMap.get(injectionInfo.token);
        if (tokenBindings && tokenBindings.length > 0) {
          await this.handleBindings(tokenBindings, propertyName);
          return;
        }
      }
    }
    
    // Try direct binding lookup
    let bindings = this.bindingsMap.get(symbol);

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