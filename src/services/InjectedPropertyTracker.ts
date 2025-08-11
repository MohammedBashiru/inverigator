import * as vscode from 'vscode';
import * as ts from 'typescript';
import { createSourceFile } from '../utils/astUtils';

/**
 * Tracks which properties in a class are actually injected via @inject decorator
 * This helps prevent looking up non-injected properties as if they were services
 */
export class InjectedPropertyTracker {
  // Map of file path -> class name -> Set of injected property names
  private injectedPropertiesMap: Map<string, Map<string, Set<string>>> = new Map();
  
  // Cache of processed files to avoid re-parsing
  private processedFiles: Set<string> = new Set();
  
  constructor(private outputChannel: vscode.OutputChannel) {}
  
  /**
   * Clear all cached data
   */
  public clear(): void {
    this.injectedPropertiesMap.clear();
    this.processedFiles.clear();
  }
  
  /**
   * Check if a property is injected in a given class
   */
  public isInjectedProperty(
    filePath: string,
    className: string,
    propertyName: string
  ): boolean {
    // Ensure the file has been processed
    if (!this.processedFiles.has(filePath)) {
      this.processFile(filePath);
    }
    
    const fileMap = this.injectedPropertiesMap.get(filePath);
    if (!fileMap) {
      return false;
    }
    
    const classProperties = fileMap.get(className);
    if (!classProperties) {
      return false;
    }
    
    return classProperties.has(propertyName);
  }
  
  /**
   * Get all injected properties for a class
   */
  public getInjectedProperties(
    filePath: string,
    className: string
  ): Set<string> {
    // Ensure the file has been processed
    if (!this.processedFiles.has(filePath)) {
      this.processFile(filePath);
    }
    
    const fileMap = this.injectedPropertiesMap.get(filePath);
    if (!fileMap) {
      return new Set();
    }
    
    return fileMap.get(className) || new Set();
  }
  
  /**
   * Process a file to extract injected properties
   */
  private processFile(filePath: string): void {
    if (this.processedFiles.has(filePath)) {
      return;
    }
    
    this.processedFiles.add(filePath);
    
    try {
      const sourceFile = createSourceFile(filePath);
      if (!sourceFile) {
        return;
      }
      
      const fileMap = new Map<string, Set<string>>();
      
      // Find all classes in the file
      this.findClassesWithInjections(sourceFile, fileMap);
      
      if (fileMap.size > 0) {
        this.injectedPropertiesMap.set(filePath, fileMap);
        
        // Log what we found for debugging
        fileMap.forEach((properties, className) => {
          if (properties.size > 0) {
            this.outputChannel.appendLine(
              `Found injected properties in ${className}: ${Array.from(properties).join(', ')}`
            );
          }
        });
      }
    } catch (error) {
      this.outputChannel.appendLine(`Error processing file ${filePath}: ${error}`);
    }
  }
  
  /**
   * Find all classes with injected properties in a source file
   */
  private findClassesWithInjections(
    node: ts.Node,
    fileMap: Map<string, Set<string>>
  ): void {
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const injectedProperties = new Set<string>();
      
      // Look for constructor with @inject decorators
      node.members.forEach(member => {
        if (ts.isConstructorDeclaration(member)) {
          member.parameters.forEach(param => {
            // Check if parameter has @inject decorator
            if (this.hasInjectDecorator(param)) {
              // Get the property name (if it's a parameter property)
              if (param.modifiers?.some(mod => 
                mod.kind === ts.SyntaxKind.PrivateKeyword ||
                mod.kind === ts.SyntaxKind.ProtectedKeyword ||
                mod.kind === ts.SyntaxKind.PublicKeyword ||
                mod.kind === ts.SyntaxKind.ReadonlyKeyword
              )) {
                const paramName = (param.name as ts.Identifier).text;
                injectedProperties.add(paramName);
              }
            }
          });
        }
        
        // Also check for property injection (less common but possible)
        if (ts.isPropertyDeclaration(member) && member.name) {
          if (this.hasInjectDecorator(member)) {
            const propName = (member.name as ts.Identifier).text;
            injectedProperties.add(propName);
          }
        }
      });
      
      if (injectedProperties.size > 0) {
        fileMap.set(className, injectedProperties);
      }
    }
    
    // Recursively process child nodes
    ts.forEachChild(node, child => this.findClassesWithInjections(child, fileMap));
  }
  
  /**
   * Check if a node has an @inject decorator
   */
  private hasInjectDecorator(node: ts.Node): boolean {
    if (!ts.canHaveDecorators(node)) {
      return false;
    }
    
    const decorators = ts.getDecorators(node);
    if (!decorators) {
      return false;
    }
    
    return decorators.some(decorator => {
      if (ts.isCallExpression(decorator.expression)) {
        const expression = decorator.expression.expression;
        if (ts.isIdentifier(expression)) {
          return expression.text === 'inject';
        }
      }
      return false;
    });
  }
  
  /**
   * Get the class name at a given position in a document
   */
  public getClassNameAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string | undefined {
    try {
      const sourceFile = ts.createSourceFile(
        document.fileName,
        document.getText(),
        ts.ScriptTarget.Latest,
        true
      );
      
      const offset = document.offsetAt(position);
      
      // Find the class that contains this position
      const findClass = (node: ts.Node): string | undefined => {
        if (ts.isClassDeclaration(node) && node.name) {
          const start = node.getStart();
          const end = node.getEnd();
          
          if (offset >= start && offset <= end) {
            return node.name.text;
          }
        }
        
        let result: string | undefined;
        ts.forEachChild(node, child => {
          if (!result) {
            result = findClass(child);
          }
        });
        
        return result;
      };
      
      return findClass(sourceFile);
    } catch (error) {
      this.outputChannel.appendLine(`Error finding class at position: ${error}`);
      return undefined;
    }
  }
  
  /**
   * Check if a position is within a class method or property access
   */
  public isInClassContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): boolean {
    const className = this.getClassNameAtPosition(document, position);
    return className !== undefined;
  }
  
  /**
   * Invalidate cache for a specific file
   */
  public invalidateFile(filePath: string): void {
    this.processedFiles.delete(filePath);
    this.injectedPropertiesMap.delete(filePath);
  }
  
  /**
   * Get statistics about tracked properties
   */
  public getStats(): { files: number; classes: number; properties: number } {
    let totalClasses = 0;
    let totalProperties = 0;
    
    this.injectedPropertiesMap.forEach(fileMap => {
      totalClasses += fileMap.size;
      fileMap.forEach(properties => {
        totalProperties += properties.size;
      });
    });
    
    return {
      files: this.injectedPropertiesMap.size,
      classes: totalClasses,
      properties: totalProperties
    };
  }
}