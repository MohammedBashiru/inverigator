import * as ts from 'typescript';
import * as fs from 'fs';

export function createSourceFile(filePath: string): ts.SourceFile | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const source = fs.readFileSync(filePath, 'utf-8');
    return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  } catch (error) {
    console.error(`Error creating source file for ${filePath}:`, error);
    return null;
  }
}

export function extractIdentifier(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile);
  
  // Remove quotes if it's a string literal
  if (text.startsWith('"') || text.startsWith("'") || text.startsWith('`')) {
    return text.slice(1, -1);
  }
  
  // Handle Symbol() calls
  if (text.startsWith('Symbol(') || text.startsWith('Symbol.for(')) {
    const match = text.match(/Symbol(?:\.for)?\(['"`](.+?)['"`]\)/);
    return match ? match[1] : text;
  }
  
  return text;
}

export function hasDecorator(node: ts.ClassDeclaration, decoratorNames: string[], sourceFile: ts.SourceFile): boolean {
  const nodeText = node.getText(sourceFile);
  return decoratorNames.some(decorator => nodeText.includes(decorator));
}

export function getClassName(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): string | null {
  return node.name ? node.name.getText(sourceFile) : null;
}

export function getMethodNames(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): string[] {
  const methods: string[] = [];
  
  node.members.forEach(member => {
    if (ts.isMethodDeclaration(member) && member.name) {
      const methodName = member.name.getText(sourceFile);
      if (!methodName.startsWith('_') && methodName !== 'constructor') {
        methods.push(methodName);
      }
    }
  });
  
  return methods;
}

export function findImports(sourceFile: ts.SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  
  ts.forEachChild(sourceFile, node => {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const importPath = moduleSpecifier.text;
        
        if (node.importClause && node.importClause.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            node.importClause.namedBindings.elements.forEach(element => {
              const name = element.name.getText(sourceFile);
              imports.set(name, importPath);
            });
          }
        }
      }
    }
  });
  
  return imports;
}