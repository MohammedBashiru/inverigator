import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { minimatch } from 'minimatch';

export class IgnorePatternMatcher {
  private patterns: string[] = [];
  private customPatternCount = 0;
  private hasIgnoreFile = false;

  // Default patterns to always exclude (already in glob format)
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
            .filter(line => line && !line.startsWith('#')) // Skip empty lines and comments
            .map(pattern => this.convertToGlobPattern(pattern)); // Convert gitignore to glob
          
          this.customPatternCount = customPatterns.length;
          this.patterns.push(...customPatterns);

          console.log(`Loaded ${customPatterns.length} custom patterns from .inverigatorignore`);
          console.log(`Total patterns (default + custom): ${this.patterns.length}`);
        } catch (error) {
          console.error('Error reading .inverigatorignore:', error);
        }
        break; // Use first .inverigatorignore found
      }
    }
  }

  /**
   * Convert gitignore-style patterns to VS Code glob patterns
   */
  private convertToGlobPattern(pattern: string): string {
    console.log(`Converting pattern: "${pattern}"`);
    
    // If pattern already has glob syntax, return as-is
    if (pattern.includes('**')) {
      console.log(`  -> Already has **: "${pattern}"`);
      return pattern;
    }
    
    // Handle directory patterns (ending with /)
    if (pattern.endsWith('/')) {
      // Convert "src/" to "**/src/**"
      const converted = `**/${pattern}**`;
      console.log(`  -> Directory pattern: "${converted}"`);
      return converted;
    }
    
    // Handle patterns starting with * (like *.test.ts)
    if (pattern.startsWith('*')) {
      // Convert "*.test.ts" to "**/*.test.ts"
      const converted = `**/${pattern}`;
      console.log(`  -> Wildcard pattern: "${converted}"`);
      return converted;
    }
    
    // Handle simple directory names without trailing slash
    // But be careful not to convert file extensions
    if (!pattern.includes('*') && !pattern.includes('.') && !pattern.includes('/')) {
      // Convert "src" to "**/src/**"
      const converted = `**/${pattern}/**`;
      console.log(`  -> Simple directory: "${converted}"`);
      return converted;
    }
    
    // Handle file patterns with extensions
    if (pattern.includes('.') && !pattern.startsWith('*')) {
      // Convert "file.txt" to "**/file.txt"
      const converted = `**/${pattern}`;
      console.log(`  -> File pattern: "${converted}"`);
      return converted;
    }
    
    // Handle paths with slashes (like api/src/)
    if (pattern.includes('/')) {
      // If it doesn't end with /, add /** to match contents
      const converted = pattern.endsWith('/') ? `**/${pattern}**` : `**/${pattern}/**`;
      console.log(`  -> Path pattern: "${converted}"`);
      return converted;
    }
    
    // Return pattern as-is for other cases
    console.log(`  -> Unchanged: "${pattern}"`);
    return pattern;
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
  getInfo(): { hasIgnoreFile: boolean; patternCount: number; customPatternCount: number; totalPatternCount: number } {
    return {
      hasIgnoreFile: this.hasIgnoreFile,
      patternCount: this.customPatternCount, // For backward compatibility
      customPatternCount: this.customPatternCount,
      totalPatternCount: this.patterns.length
    };
  }

  /**
   * Get exclude glob pattern for VS Code's findFiles API
   * VS Code expects a single glob pattern string with alternatives separated by commas
   */
  getExcludeGlob(): string {
    // VS Code's findFiles API expects a glob pattern like: "{pattern1,pattern2,pattern3}"
    // Convert our patterns to a format VS Code understands
    if (this.patterns.length === 0) {
      return '**/node_modules/**';
    }

    if (this.patterns.length === 1) {
      return this.patterns[0];
    }

    // Wrap multiple patterns in braces
    const excludeGlob = `{${this.patterns.join(',')}}`;
    console.log('Generated exclude glob:', excludeGlob);
    console.log('Total patterns:', this.patterns.length);
    return excludeGlob;
  }

  /**
   * Create a sample .inverigatorignore file
   */
  static createSampleIgnoreFile(): string {
    return `# Inverigator ignore file
# Add patterns for files/directories to exclude from scanning
# Uses gitignore-style patterns

# Test files (already excluded by default)
*.test.ts
*.spec.ts
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

# To exclude specific directories:
# src/           - excludes any 'src' directory
# api/src/       - excludes specific path
# **/tests/**    - excludes any 'tests' directory and its contents

# Custom patterns for your project
# Add your patterns below:
`;
  }
}
