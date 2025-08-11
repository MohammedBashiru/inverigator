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

## Known Limitations & Improvements Needed

1. **TypeScript Dependency**: TypeScript is listed as a devDependency but is imported and used at runtime. This needs to be moved to dependencies or bundled.

2. **Container Path**: Currently hardcoded to `src/container.ts`. Should be configurable via settings or auto-discovered.

3. **AST Parsing**: The current implementation has limitations:
   - Only detects direct `container.bind().to()` patterns
   - Won't detect bindings split across multiple lines or stored in variables
   - Doesn't handle dynamic bindings or factory bindings

4. **File Discovery**: Implementation file search assumes the class name matches the filename, which may not always be true.

5. **Error Handling**: Needs better error handling for:
   - Missing container file
   - TypeScript parsing errors
   - Multiple potential implementation files