// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

let bindingsMap: Record<string, string> = {};

function scanContainer(containerPath: string) {
  const source = fs.readFileSync(containerPath, 'utf-8');
  const sf = ts.createSourceFile(containerPath, source, ts.ScriptTarget.Latest, true);

  ts.forEachChild(sf, node => {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const callExpr = node.expression;
      const text = callExpr.expression.getText(sf);

      // Look for container.bind().to()
      if (text.includes('container.bind') && callExpr.arguments.length > 0) {
        const tokenArg = callExpr.arguments[0];
        const bindToken = tokenArg.getText(sf);

        // Try to find the .to(...) chained call
        if (
          callExpr.parent &&
          ts.isCallExpression(callExpr.parent) &&
          callExpr.parent.expression.getText(sf).includes('.to')
        ) {
          const implArg = callExpr.parent.arguments[0];
          if (implArg) {
            bindingsMap[bindToken] = implArg.getText(sf);
          }
        }
      }
    }
  });
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Adjust path to your actual container file
  const containerFile = path.join(vscode.workspace.rootPath || '', 'src/container.ts');
  scanContainer(containerFile);

  const disposable = vscode.commands.registerCommand(
    'inversifyNavigator.goToImplementation',
    () => {
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

      const implName = bindingsMap[symbol];
      if (!implName) {
        vscode.window.showErrorMessage(`No Inversify implementation found for: ${symbol}`);
        return;
      }

      // Try to find the file containing the class
      vscode.workspace.findFiles(`**/${implName}.ts`).then(files => {
        if (files.length > 0) {
          vscode.workspace.openTextDocument(files[0]).then(doc => {
            vscode.window.showTextDocument(doc);
          });
        } else {
          vscode.window.showErrorMessage(`Implementation file not found for: ${implName}`);
        }
      });
    }
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
