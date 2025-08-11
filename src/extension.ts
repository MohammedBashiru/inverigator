import * as vscode from 'vscode';
import { InversifyNavigator } from './core/InversifyNavigator';
import { COMMANDS, OUTPUT_CHANNEL_NAME, DIAGNOSTIC_SOURCE, EXTENSION_NAME } from './constants';

let navigator: InversifyNavigator | undefined;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  
  context.subscriptions.push(outputChannel, diagnostics);
  
  navigator = new InversifyNavigator(context, outputChannel, diagnostics);
  
  // Initialize the navigator
  navigator.initialize().then(() => {
    outputChannel.appendLine(`${EXTENSION_NAME} extension activated successfully`);
    outputChannel.appendLine(`Scanned ${navigator!.getProcessedFilesCount()} files`);
    outputChannel.appendLine(`Found ${navigator!.getBindingsCount()} bindings`);
  }).catch(error => {
    outputChannel.appendLine(`Failed to initialize: ${error}`);
    vscode.window.showErrorMessage(`${EXTENSION_NAME} failed to initialize: ${error}`);
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
}

export function deactivate() {
  navigator?.dispose();
  navigator = undefined;
}