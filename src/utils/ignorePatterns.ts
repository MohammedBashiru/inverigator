import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { minimatch } from 'minimatch';

export class IgnorePatternMatcher {
  private patterns: string[] = [];
  private hasIgnoreFile = false;

  // Default patterns to always exclude
  private static readonly DEFAULT_PATTERNS = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/test/**',
    '**/tests/**',
    '**/*.d.ts', // Type definition files
    '**/vendor/**',
    '**/third_party/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/tmp/**',
    '**/temp/**'
  ];

  constructor() {
    this.loadIgnorePatterns();
  }

  private loadIgnorePatterns() {
    // Start with default patterns
    this.patterns = [...IgnorePatternMatcher.DEFAULT_PATTERNS];

    // Try to find .inverigatorignore file
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    for (const folder of workspaceFolders) {
      const ignoreFilePath = path.join(folder.uri.fsPath, '.inverigatorignore');
      
      if (fs.existsSync(ignoreFilePath)) {
        this.hasIgnoreFile = true;
        try {
          const content = fs.readFileSync(ignoreFilePath, 'utf-8');
          const customPatterns = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#')); // Skip empty lines and comments
          
          this.patterns.push(...customPatterns);
          
          console.log(`Loaded ${customPatterns.length} patterns from .inverigatorignore`);
        } catch (error) {
          console.error('Error reading .inverigatorignore:', error);
        }
        break; // Use first .inverigatorignore found
      }
    }
  }

  /**
   * Check if a file path should be ignored
   */
  shouldIgnore(filePath: string): boolean {
    // Get relative path from workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return false;
    }

    let relativePath = filePath;
    for (const folder of workspaceFolders) {
      if (filePath.startsWith(folder.uri.fsPath)) {
        relativePath = path.relative(folder.uri.fsPath, filePath);
        break;
      }
    }

    // Check against all patterns
    for (const pattern of this.patterns) {
      if (minimatch(relativePath, pattern) || minimatch(filePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Filter an array of URIs to exclude ignored files
   */
  filterFiles(files: vscode.Uri[]): vscode.Uri[] {
    return files.filter(file => !this.shouldIgnore(file.fsPath));
  }

  /**
   * Get information about ignore configuration
   */
  getInfo(): { hasIgnoreFile: boolean; patternCount: number } {
    return {
      hasIgnoreFile: this.hasIgnoreFile,
      patternCount: this.patterns.length
    };
  }

  /**
   * Create a sample .inverigatorignore file
   */
  static createSampleIgnoreFile(): string {
    return `# Inverigator ignore file
# Add patterns for files/directories to exclude from scanning
# Uses gitignore-style patterns

# Test files (already excluded by default)
**/*.test.ts
**/*.spec.ts
__tests__/
__mocks__/

# Build outputs
dist/
build/
out/
.next/
.nuxt/

# Dependencies
node_modules/
vendor/

# Development/tooling
scripts/
tools/
.vscode/
.idea/

# Examples and demos
examples/
demos/
samples/

# Temporary files
tmp/
temp/
*.tmp

# Custom patterns for your project
# Add your patterns below:
`;
  }
}