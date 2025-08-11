# Inverigator

> Navigate InversifyJS dependency injections with ease

[![Version](https://img.shields.io/visual-studio-marketplace/v/inverigator)](https://marketplace.visualstudio.com/items?itemName=inverigator)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/inverigator)](https://marketplace.visualstudio.com/items?itemName=inverigator)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/inverigator)](https://marketplace.visualstudio.com/items?itemName=inverigator)

Inverigator is a powerful VS Code extension that helps developers navigate InversifyJS dependency injection containers. Jump instantly from injected dependencies to their concrete implementations, making it easier to understand and work with complex IoC container setups.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [Navigation Commands](#navigation-commands)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Context Menus](#context-menus)
- [Configuration](#configuration)
  - [Extension Settings](#extension-settings)
  - [Ignore Patterns](#ignore-patterns)
- [How It Works](#how-it-works)
- [Requirements](#requirements)
- [Known Issues](#known-issues)
- [Release Notes](#release-notes)
- [Contributing](#contributing)
- [License](#license)

## Features

🚀 **Smart Navigation**
- Navigate from injection tokens to their concrete implementations
- Jump from interfaces to their bound implementations
- Navigate from injected properties to their service classes
- Support for Symbol-based and string-based injection tokens

🔍 **Comprehensive Scanning**
- Content-based scanning finds all bindings regardless of file location
- Supports modular container architectures with deep import following
- Automatically discovers registry and configuration modules
- Resolves TypeScript path aliases from `tsconfig.json`

⚡ **Developer Experience**
- CodeLens integration shows clickable links above injections
- Rich context menu integration
- Multiple keyboard shortcuts for quick access
- Real-time file watching with automatic rescanning
- Output channel for debugging and diagnostics

🎯 **Flexible Configuration**
- Customizable container file patterns
- `.inverigatorignore` file support for excluding files/directories
- Configurable scan depth for modular containers
- Toggle auto-scan and CodeLens features

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Ctrl+P` / `Cmd+P` to open the Quick Open dialog
3. Type `ext install inverigator` and press Enter
4. Click the Install button

### From VSIX Package

1. Download the latest `.vsix` file from the releases page
2. Open VS Code
3. Press `Ctrl+Shift+P` / `Cmd+Shift+P` to open the Command Palette
4. Type `Extensions: Install from VSIX...` and press Enter
5. Select the downloaded `.vsix` file

## Usage

### Navigation Commands

Inverigator provides several commands for navigating your InversifyJS containers:

#### Go to Implementation (`inversifyNavigator.goToImplementation`)
Navigate from an injection token, interface, or injected property to its concrete implementation.

**Example scenarios:**
```typescript
// Navigate from token to implementation
container.bind(TYPES.UserService).to(UserService);
//            ^^^^^^^^^^^^^^^^^ Place cursor here and run command

// Navigate from interface to implementation
interface IUserService { }
//        ^^^^^^^^^^^^ Place cursor here and run command

// Navigate from injected property to implementation
@inject(TYPES.UserService) private userService: IUserService;
//                                  ^^^^^^^^^^^ Place cursor here and run command
```

#### Show All Bindings (`inverigator.showBindings`)
Display a searchable list of all discovered InversifyJS bindings in your workspace.

#### Rescan Container Files (`inverigator.rescan`)
Manually trigger a rescan of all container files to update the bindings map.

#### Show Injection Mappings (`inverigator.showInjections`)
View all discovered interface-to-token mappings from `@inject` decorators.

#### Generate Ignore File (`inverigator.generateIgnoreFile`)
Create a sample `.inverigatorignore` file with common exclusion patterns.

### Keyboard Shortcuts

| Command | Windows/Linux | macOS |
|---------|--------------|-------|
| Go to Implementation | `Ctrl+Alt+F12` or `Alt+F12` or `Ctrl+Alt+I` | `Cmd+Alt+F12` or `Alt+F12` or `Cmd+Alt+I` |

### Context Menus

Inverigator integrates seamlessly with VS Code's context menus:

- **Editor Context Menu**: Right-click in any TypeScript file to access "Go to Inversify Implementation"
- **Editor Title Bar**: Quick access buttons for "Show All Bindings" and "Rescan Container Files"
- **Explorer Context Menu**: Right-click TypeScript files in the explorer to trigger rescanning
- **Command Palette**: All commands available via `Ctrl+Shift+P` / `Cmd+Shift+P`

## Configuration

### Extension Settings

Configure Inverigator through VS Code settings (`File > Preferences > Settings` or `settings.json`):

#### `inverigator.containerPaths`
Array of glob patterns to identify InversifyJS container files.

**Default:**
```json
[
  "**/container.ts",
  "**/inversify.config.ts",
  "**/ioc.ts"
]
```

**Example:**
```json
{
  "inverigator.containerPaths": [
    "**/container.ts",
    "**/di-container.ts",
    "**/src/config/ioc.ts"
  ]
}
```

#### `inverigator.autoScanOnSave`
Automatically rescan container files when they are saved.

**Default:** `true`

#### `inverigator.maxScanDepth`
Maximum depth to follow imports when scanning modular containers.

**Default:** `5` (Range: 1-10)

#### `inverigator.enableCodeLens`
Show clickable "Go to Implementation" links above InversifyJS injections and bindings.

**Default:** `true`

### Ignore Patterns

Create a `.inverigatorignore` file in your project root to exclude specific files or directories from scanning. The file uses gitignore-style syntax.

**Default exclusions:**
- Test files (`*.test.ts`, `*.spec.ts`, `__tests__/`, `__mocks__/`)
- Build outputs (`dist/`, `build/`, `out/`)
- Dependencies (`node_modules/`, `vendor/`)
- Type definitions (`*.d.ts`)
- Temporary files (`tmp/`, `temp/`)

**Example `.inverigatorignore`:**
```gitignore
# Custom exclusions
examples/
archived/
legacy/

# Exclude specific patterns
**/*.backup.ts
**/*.old.ts

# Exclude generated files
src/generated/
```

To generate a sample ignore file, use the command: `Inverigator: Generate .inverigatorignore File`

## How It Works

Inverigator uses advanced TypeScript AST parsing to understand your InversifyJS container configuration:

1. **Discovery Phase**
   - Scans workspace for container files matching configured patterns
   - Uses content-based scanning to find all `.bind(` patterns
   - Recursively follows imports to discover modular registries

2. **Analysis Phase**
   - Parses TypeScript AST to extract binding information
   - Maps injection tokens (strings, Symbols, identifiers) to implementations
   - Resolves TypeScript path aliases using `tsconfig.json`
   - Follows export declarations to find actual implementations

3. **Indexing Phase**
   - Builds comprehensive maps of:
     - Token → Implementation class
     - Interface → Token (from `@inject` decorators)
     - Service classes and their locations

4. **Navigation Phase**
   - Determines context at cursor position (token, interface, or property)
   - Resolves through injection mappings if needed
   - Opens implementation file at the correct location

## Requirements

- VS Code version 1.103.0 or higher
- TypeScript project using InversifyJS for dependency injection
- TypeScript installed in your project (used for AST parsing)

## Known Issues

- Complex dynamic bindings may not be detected
- Conditional bindings based on runtime values are not fully supported
- Very large workspaces may experience initial scanning delays

Please report issues on our [GitHub repository](https://github.com/yourusername/inverigator/issues).

## Release Notes

### 0.0.1 - Initial Release

#### Features
- ✨ Basic navigation from injection tokens to implementations
- ✨ Support for Symbol and string-based tokens
- ✨ Content-based scanning strategy
- ✨ TypeScript config path alias resolution
- ✨ Interface and property navigation
- ✨ CodeLens integration
- ✨ Context menu integration
- ✨ Multiple keyboard shortcuts
- ✨ Configurable container paths
- ✨ `.inverigatorignore` file support
- ✨ Real-time file watching
- ✨ Output channel for diagnostics

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

1. Clone the repository
2. Run `npm install` to install dependencies
3. Open the project in VS Code
4. Press `F5` to launch a new VS Code window with the extension loaded
5. Make changes and test them in the Extension Development Host

### Running Tests

```bash
npm run test        # Run all tests
npm run lint        # Run linting
npm run check-types # Type checking
```

## License

This extension is licensed under the [MIT License](LICENSE).

---

**Enjoy navigating your InversifyJS containers with ease!** 🚀

If you find this extension helpful, please consider:
- ⭐ Starring the repository on [GitHub](https://github.com/MohammedBashiru/inverigator)
- 📝 Leaving a review on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=inverigator)
- 🐛 Reporting issues or suggesting features