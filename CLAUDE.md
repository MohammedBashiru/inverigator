# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VS Code extension called "inverigator" that helps developers navigate to InversifyJS implementations from injected types. The extension scans InversifyJS container bindings and provides a "Go to Implementation" command to jump from dependency injection tokens to their concrete implementations.

## Development Commands

### Build and Compilation
- `npm run compile` - Full compilation with type checking and linting
- `npm run package` - Production build for distribution
- `npm run watch` - Watch mode for development (runs TypeScript and esbuild in parallel)

### Code Quality
- `npm run lint` - Run ESLint on src directory
- `npm run check-types` - Run TypeScript type checking without emitting files

### Testing
- `npm run test` - Run all tests via VS Code test runner
- `npm run compile-tests` - Compile tests to out directory
- `npm run watch-tests` - Watch and compile tests continuously

### VS Code Extension Specific
- `npm run vscode:prepublish` - Runs before publishing to VS Code marketplace

## Architecture

### Key Files
- `src/extension.ts` - Main extension entry point containing activate/deactivate functions
- `package.json` - Extension manifest defining commands, activation events, and contributions
- `esbuild.js` - Build configuration for bundling the extension
- `dist/extension.js` - Compiled and bundled extension output

### Extension Structure
The extension follows the standard VS Code extension architecture:
1. **Activation**: The extension activates based on events defined in `package.json`
2. **Commands**: Commands are registered in the `activate` function and defined in `package.json` contributes section
3. **Build Process**: Uses esbuild for fast bundling, outputs to `dist/` directory

### Core Functionality
The extension implements InversifyJS navigation through:
1. **Container Scanning**: On activation, scans `src/container.ts` for InversifyJS bindings using TypeScript AST
2. **Binding Map**: Builds a map of tokens to implementation classes from `container.bind(Token).to(Implementation)` patterns
3. **Navigation Command**: `inversifyNavigator.goToImplementation` command that:
   - Gets the symbol at cursor position
   - Looks up the implementation in the bindings map
   - Searches workspace for the implementation file
   - Opens the implementation file in the editor

### Dependencies
- **typescript**: Required as a runtime dependency for AST parsing of container files
- Note: TypeScript is currently in devDependencies but is used at runtime in the extension

## Testing Approach
- Tests are written in TypeScript in `src/test/` directory
- Tests compile to `out/` directory before running
- Uses VS Code's test runner infrastructure (@vscode/test-cli and @vscode/test-electron)
- Test configuration is in `.vscode-test.mjs`

## TypeScript Configuration
- Target: ES2022
- Module: Node16
- Strict mode enabled
- Source maps enabled for debugging
- Root directory: `src/`

## Recent Improvements

The extension has been significantly improved with:

1. **✅ TypeScript Dependency**: Moved to dependencies for proper runtime usage
2. **✅ Configurable Container Paths**: Added settings for multiple container file patterns
3. **✅ Enhanced AST Parsing**: Improved to handle various binding patterns including Symbol() tokens
4. **✅ Smart File Discovery**: Multiple search strategies including kebab-case, snake_case, and content-based search
5. **✅ Comprehensive Error Handling**: Added output channel, diagnostics, and graceful error recovery
6. **✅ Multiple Container Support**: Scans all matching container files in workspace
7. **✅ File Watching**: Auto-rescan on container file changes
8. **✅ New Commands**: Added "Show All Bindings" and "Rescan Container Files" commands

## Extension Commands

- `inversifyNavigator.goToImplementation`: Navigate from injection token to implementation
- `inverigator.showBindings`: Display all discovered InversifyJS bindings
- `inverigator.rescan`: Manually rescan all container files

## Configuration Settings

- `inverigator.containerPaths`: Array of glob patterns for container files (default: `["**/container.ts", "**/inversify.config.ts", "**/ioc.ts"]`)
- `inverigator.autoScanOnSave`: Auto-rescan when container files change (default: `true`)

## Context Menu Integration

The extension adds commands to various VS Code menus:

### Right-Click Context Menu (Editor)
- **Go to Inversify Implementation**: Available when right-clicking in TypeScript/JavaScript files
- **Show All Bindings**: Available in the context menu under "Inverigator" group

### Editor Title Bar
- Icons for "Show All Bindings" and "Rescan Container Files" in the editor title bar for TypeScript files

### Explorer Context Menu
- **Rescan Container Files**: Available when right-clicking TypeScript files in the explorer

### Keyboard Shortcuts
- **F12**: Go to Inversify Implementation (same as VS Code's "Go to Definition")
- **Ctrl+F12** (Windows/Linux) / **Cmd+F12** (Mac): Alternative shortcut for Go to Implementation

### Command Palette
All commands are available through the Command Palette (Ctrl+Shift+P / Cmd+Shift+P):
- `Inverigator: Go to Inversify Implementation`
- `Inverigator: Show All Bindings`
- `Inverigator: Rescan Container Files`