export const EXTENSION_NAME = 'Inverigator';
export const OUTPUT_CHANNEL_NAME = 'Inverigator';
export const DIAGNOSTIC_SOURCE = 'inverigator';

export const DEFAULT_CONFIG = {
  containerPaths: [
    '**/container.ts', 
    '**/inversify.config.ts', 
    '**/ioc.ts',
    '**/container.config.ts',
    '**/di.config.ts',
    '**/injection.config.ts',
    '**/bindings.ts',
    '**/registry.ts',
    '**/*Registry.ts',
    '**/*registry.ts',
    '**/services.ts',  // Found many bindings here
    '**/repositories.ts',  // Found many bindings here
    '**/validators.ts'  // Found many bindings here
  ],
  maxScanDepth: 5,
  autoScanOnSave: true
};

export const FILE_PATTERNS = {
  registry: [
    '**/*registry*.ts',
    '**/*Registry*.ts',
    '**/*bindings*.ts',
    '**/*Bindings*.ts',
    '**/*container*.ts',
    '**/*Container*.ts'
  ],
  typescript: '**/*.{ts,tsx}',
  javascript: '**/*.{js,jsx}',
  excludeNodeModules: '**/node_modules/**'
};

export const COMMANDS = {
  goToImplementation: 'inversifyNavigator.goToImplementation',
  showBindings: 'inverigator.showBindings',
  rescan: 'inverigator.rescan',
  showInjections: 'inverigator.showInjections',
  generateIgnoreFile: 'inverigator.generateIgnoreFile'
};

export const PATTERNS = {
  configurationFunctions: ['Configure', 'Registry', 'register', 'Bind'],
  serviceClassSuffixes: ['Service', 'Repository', 'Controller', 'Provider'],
  decorators: ['@injectable', '@Injectable', '@inject', '@Inject']
};