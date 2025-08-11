import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import { createSourceFile } from '../utils/astUtils';
import { findFiles } from '../utils/fileUtils';
import { FILE_PATTERNS } from '../constants';

export interface InjectionInfo {
  propertyName: string;
  interfaceType: string;
  token: string;
  file: string;
  line: number;
}

export class InjectionMapper {
  private interfaceToTokenMap: Map<string, string> = new Map();
  private propertyToInterfaceMap: Map<string, InjectionInfo> = new Map();
  private tokenToInterfaceMap: Map<string, string> = new Map();

  constructor(private outputChannel: vscode.OutputChannel) {}

  async mapInjections(): Promise<void> {
    this.interfaceToTokenMap.clear();
    this.propertyToInterfaceMap.clear();
    this.tokenToInterfaceMap.clear();

    // Scan all TypeScript files for @inject decorators
    const tsFiles = await findFiles(FILE_PATTERNS.typescript);
    
    for (const file of tsFiles) {
      try {
        const sourceFile = createSourceFile(file.fsPath);
        if (sourceFile) {
          this.extractInjectionInfo(sourceFile, file.fsPath);
        }
      } catch (error) {
        // Silently skip files that can't be parsed
      }
    }

    this.outputChannel.appendLine(
      `Mapped ${this.interfaceToTokenMap.size} interface->token relationships`
    );
  }

  private extractInjectionInfo(sourceFile: ts.SourceFile, filePath: string) {
    const visit = (node: ts.Node) => {
      // Look for constructor parameters with @inject decorator
      if (ts.isConstructorDeclaration(node)) {
        this.extractConstructorInjections(node, sourceFile, filePath);
      }
      
      // Look for property declarations with @inject decorator
      if (ts.isPropertyDeclaration(node)) {
        this.extractPropertyInjections(node, sourceFile, filePath);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  private extractConstructorInjections(
    node: ts.ConstructorDeclaration, 
    sourceFile: ts.SourceFile,
    filePath: string
  ) {
    node.parameters.forEach(param => {
      // Get the full text including decorators
      let decoratorText = '';
      let paramName = '';
      let typeName = '';
      
      // Check for decorators on the parameter
      if (param.modifiers) {
        param.modifiers.forEach(modifier => {
          const modifierText = modifier.getText(sourceFile);
          if (modifierText.includes('@inject')) {
            decoratorText = modifierText;
          }
        });
      }
      
      // If no decorator found in modifiers, check the whole parameter text
      if (!decoratorText) {
        const paramText = param.getText(sourceFile);
        const injectMatch = paramText.match(/@inject\s*\(\s*([^)]+)\s*\)/);
        if (injectMatch) {
          decoratorText = injectMatch[0];
        }
      }
      
      // Extract token from decorator
      const tokenMatch = decoratorText.match(/@inject\s*\(\s*([^)]+)\s*\)/);
      if (tokenMatch) {
        const token = tokenMatch[1].trim();
        
        // Extract the parameter name
        if (param.name && ts.isIdentifier(param.name)) {
          paramName = param.name.getText(sourceFile);
        }
        
        // Get the type annotation
        if (param.type) {
          typeName = param.type.getText(sourceFile).replace(/\s/g, '');
        }
        
        if (paramName && typeName) {
          // Map interface to token
          this.interfaceToTokenMap.set(typeName, token);
          this.tokenToInterfaceMap.set(token, typeName);
          
          // Store property info for later lookup
          const pos = sourceFile.getLineAndCharacterOfPosition(param.getStart());
          const injectionInfo: InjectionInfo = {
            propertyName: paramName,
            interfaceType: typeName,
            token: token,
            file: filePath,
            line: pos.line
          };
          
          // Map by property name for navigation - use a unique key per file
          const key = `${path.basename(filePath)}:${paramName}`;
          this.propertyToInterfaceMap.set(key, injectionInfo);
          // Also map without file prefix for backward compatibility
          this.propertyToInterfaceMap.set(paramName, injectionInfo);
          
          this.outputChannel.appendLine(
            `Found injection in ${path.basename(filePath)}: ${paramName}: ${typeName} -> ${token}`
          );
        }
      }
    });
  }

  private extractPropertyInjections(
    node: ts.PropertyDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ) {
    const nodeText = node.getText(sourceFile);
    
    // Look for @inject decorator
    const injectMatch = nodeText.match(/@inject\s*\(\s*([^)]+)\s*\)/);
    if (injectMatch) {
      const token = injectMatch[1];
      
      // Get property name
      if (node.name && ts.isIdentifier(node.name)) {
        const propertyName = node.name.getText(sourceFile);
        
        // Get the type annotation
        if (node.type) {
          const typeName = node.type.getText(sourceFile);
          const cleanTypeName = typeName.replace(/\s/g, '');
          
          // Map interface to token
          this.interfaceToTokenMap.set(cleanTypeName, token);
          this.tokenToInterfaceMap.set(token, cleanTypeName);
          
          // Store property info
          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          const injectionInfo: InjectionInfo = {
            propertyName: propertyName,
            interfaceType: cleanTypeName,
            token: token,
            file: filePath,
            line: pos.line
          };
          
          this.propertyToInterfaceMap.set(propertyName, injectionInfo);
          
          this.outputChannel.appendLine(
            `Found property injection: ${propertyName}: ${cleanTypeName} -> ${token}`
          );
        }
      }
    }
  }

  getTokenForInterface(interfaceName: string): string | undefined {
    return this.interfaceToTokenMap.get(interfaceName);
  }

  getInterfaceForToken(token: string): string | undefined {
    return this.tokenToInterfaceMap.get(token);
  }

  getInjectionInfoForProperty(propertyName: string): InjectionInfo | undefined {
    return this.propertyToInterfaceMap.get(propertyName);
  }

  getAllMappings(): Map<string, string> {
    return this.interfaceToTokenMap;
  }
}