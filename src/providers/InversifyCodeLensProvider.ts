import * as vscode from 'vscode';
import * as ts from 'typescript';
import { InversifyNavigator } from '../core/InversifyNavigator';
import { createSourceFile } from '../utils/astUtils';

export class InversifyCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private navigator: InversifyNavigator) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
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
    
    return codeLenses;
  }

  resolveCodeLens?(
    codeLens: vscode.CodeLens,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens> {
    // CodeLens is already resolved in provideCodeLenses
    return codeLens;
  }
}