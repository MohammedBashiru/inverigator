import * as vscode from 'vscode';
import * as ts from 'typescript';
import { ServiceInfo, ServiceMap } from '../types';
import { FILE_PATTERNS, PATTERNS } from '../constants';
import { createSourceFile, hasDecorator, getClassName, getMethodNames } from '../utils/astUtils';
import { findFiles } from '../utils/fileUtils';

export class ServiceIndexer {
  private serviceMap: ServiceMap = new Map();

  constructor(private outputChannel: vscode.OutputChannel) {}

  async indexServices(): Promise<ServiceMap> {
    this.serviceMap.clear();
    
    // Scan all TypeScript files for service classes
    const tsFiles = await findFiles(FILE_PATTERNS.typescript);
    
    for (const file of tsFiles) {
      try {
        const sourceFile = createSourceFile(file.fsPath);
        if (sourceFile) {
          this.extractServiceInfo(sourceFile, file.fsPath);
        }
      } catch (error) {
        // Silently skip files that can't be parsed
      }
    }

    this.outputChannel.appendLine(`Indexed ${this.serviceMap.size} service implementations`);
    return this.serviceMap;
  }

  private extractServiceInfo(sourceFile: ts.SourceFile, filePath: string) {
    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node)) {
        const className = getClassName(node, sourceFile);
        if (!className) {
          ts.forEachChild(node, visit);
          return;
        }

        const methods = getMethodNames(node, sourceFile);
        
        // Check if class has @injectable decorator
        const hasInjectableDecorator = hasDecorator(node, PATTERNS.decorators, sourceFile);

        // Check if class name matches service patterns
        const isServiceClass = PATTERNS.serviceClassSuffixes.some(suffix => 
          className.endsWith(suffix)
        );

        // Store service info - include all classes that look like services
        if (hasInjectableDecorator || isServiceClass || methods.length > 0) {
          this.serviceMap.set(className, {
            className,
            methods,
            file: filePath
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  getServiceInfo(className: string): ServiceInfo | undefined {
    return this.serviceMap.get(className);
  }

  getAllServices(): ServiceMap {
    return this.serviceMap;
  }
}