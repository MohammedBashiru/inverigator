import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { InversifyNavigator } from './core/InversifyNavigator';
import { COMMANDS, OUTPUT_CHANNEL_NAME, DIAGNOSTIC_SOURCE, EXTENSION_NAME } from './constants';
import { IgnorePatternMatcher } from './utils/ignorePatterns';

let navigator: InversifyNavigator | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  
  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(sync~spin) Inverigator: Scanning...';
  statusBarItem.tooltip = 'Inverigator is scanning for InversifyJS bindings';
  statusBarItem.show();
  
  context.subscriptions.push(outputChannel, diagnostics, statusBarItem);
  
  navigator = new InversifyNavigator(context, outputChannel, diagnostics);
  navigator.setStatusBarItem(statusBarItem);
  
  // Initialize the navigator
  navigator.initialize().then(() => {
    outputChannel.appendLine(`${EXTENSION_NAME} extension activated successfully`);
    outputChannel.appendLine(`Scanned ${navigator!.getProcessedFilesCount()} files`);
    outputChannel.appendLine(`Found ${navigator!.getBindingsCount()} bindings`);
    
    // Update status bar
    if (statusBarItem) {
      const bindingCount = navigator!.getBindingsCount();
      statusBarItem.text = `$(check) Inverigator: ${bindingCount} bindings`;
      statusBarItem.tooltip = `InversifyJS: ${bindingCount} bindings found\nClick to show all bindings`;
      statusBarItem.command = COMMANDS.showBindings;
    }
  }).catch(error => {
    outputChannel.appendLine(`Failed to initialize: ${error}`);
    vscode.window.showErrorMessage(`${EXTENSION_NAME} failed to initialize: ${error}`);
    
    // Update status bar to show error
    if (statusBarItem) {
      statusBarItem.text = '$(error) Inverigator: Error';
      statusBarItem.tooltip = 'Failed to scan for bindings. Click to rescan.';
      statusBarItem.command = COMMANDS.rescan;
    }
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.goToImplementation, () => {
      navigator?.goToImplementation();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.showBindings, () => {
      navigator?.showBindings();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.rescan, () => {
      navigator?.rescan();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.showInjections, () => {
      navigator?.showInjections();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.generateIgnoreFile, async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const ignoreFilePath = path.join(workspaceFolders[0].uri.fsPath, '.inverigatorignore');
      
      if (fs.existsSync(ignoreFilePath)) {
        const answer = await vscode.window.showWarningMessage(
          '.inverigatorignore already exists. Overwrite?',
          'Yes', 'No'
        );
        if (answer !== 'Yes') {
          return;
        }
      }

      try {
        fs.writeFileSync(ignoreFilePath, IgnorePatternMatcher.createSampleIgnoreFile());
        vscode.window.showInformationMessage('.inverigatorignore file created successfully');
        
        // Open the file for editing
        const doc = await vscode.workspace.openTextDocument(ignoreFilePath);
        await vscode.window.showTextDocument(doc);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create .inverigatorignore: ${error}`);
      }
    })
  );
}

export function deactivate() {
  navigator?.dispose();
  navigator = undefined;
  statusBarItem?.dispose();
  statusBarItem = undefined;
}