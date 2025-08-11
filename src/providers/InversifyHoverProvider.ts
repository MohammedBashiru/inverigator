import * as vscode from 'vscode';
import { InversifyNavigator } from '../core/InversifyNavigator';
import { InjectedPropertyTracker } from '../services/InjectedPropertyTracker';
import { shouldProcessIdentifier } from '../utils/identifierFilter';

export class InversifyHoverProvider implements vscode.HoverProvider {
  private propertyTracker: InjectedPropertyTracker;
  
  constructor(private navigator: InversifyNavigator) {
    const outputChannel = vscode.window.createOutputChannel('Inverigator-Hover', { log: true });
    this.propertyTracker = new InjectedPropertyTracker(outputChannel);
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    // First try to get a complex token like TYPES.Something
    const line = document.lineAt(position.line);
    const lineText = line.text;
    
    // Look for patterns like TYPES.Something, this.service, etc.
    let tokenToCheck: string | undefined;
    let range: vscode.Range | undefined;
    
    // Pattern 1: TYPES.Token or similar
    const typesPattern = /\b(TYPES\.[A-Za-z0-9_]+)\b/g;
    let match;
    while ((match = typesPattern.exec(lineText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (position.character >= start && position.character <= end) {
        tokenToCheck = match[1];
        range = new vscode.Range(
          position.line, start,
          position.line, end
        );
        break;
      }
    }
    
    // Pattern 2: this.propertyName
    if (!tokenToCheck) {
      const thisPattern = /\bthis\.([a-zA-Z0-9_]+)\b/g;
      while ((match = thisPattern.exec(lineText)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character >= start && position.character <= end) {
          const propertyName = match[1];
          
          // Check if this property is actually injected
          const className = this.propertyTracker.getClassNameAtPosition(document, position);
          if (className) {
            const isInjected = this.propertyTracker.isInjectedProperty(
              document.fileName,
              className,
              propertyName
            );
            
            if (isInjected) {
              tokenToCheck = propertyName;
              range = new vscode.Range(
                position.line, start,
                position.line, end
              );
            }
          }
          break;
        }
      }
    }
    
    // Pattern 3: Simple word at position
    if (!tokenToCheck) {
      const wordRange = document.getWordRangeAtPosition(position);
      if (!wordRange) {
        return undefined;
      }
      const word = document.getText(wordRange);
      
      // Skip if this is a built-in identifier
      if (!shouldProcessIdentifier(word)) {
        return undefined;
      }
      
      tokenToCheck = word;
      range = wordRange;
    }
    
    // Try to find implementation for this token
    const location = await this.navigator.getImplementationLocation(tokenToCheck);
    
    if (location) {
      const relativePath = vscode.workspace.asRelativePath(location.file);
      const fileName = relativePath.split('/').pop();
      
      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`### 🔗 InversifyJS Binding\n\n`);
      markdown.appendMarkdown(`**Token:** \`${tokenToCheck}\`\n\n`);
      markdown.appendMarkdown(`**Implementation:** \`${fileName}\`\n`);
      markdown.appendMarkdown(`📁 \`${relativePath}\`\n\n`);
      markdown.appendMarkdown(`---\n`);
      const isMac = process.platform === 'darwin';
      const shortcut = isMac ? 'Cmd+Alt+I' : 'Ctrl+Alt+I';
      markdown.appendMarkdown(`💡 *Press **${shortcut}** or **Alt+F12** to navigate*`);
      markdown.isTrusted = true;
      
      return new vscode.Hover(markdown, range);
    }

    return undefined;
  }
}