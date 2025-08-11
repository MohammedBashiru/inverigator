/**
 * Utility to filter out built-in JavaScript/TypeScript identifiers
 * and validate if an identifier should be processed for InversifyJS navigation
 */

// Common JavaScript/TypeScript built-in identifiers that should never be looked up
const BUILT_IN_IDENTIFIERS = new Set([
  // JavaScript Object methods
  'assign', 'create', 'defineProperty', 'defineProperties', 'entries', 'freeze',
  'getOwnPropertyDescriptor', 'getOwnPropertyNames', 'getOwnPropertySymbols',
  'getPrototypeOf', 'hasOwnProperty', 'is', 'isExtensible', 'isFrozen',
  'isSealed', 'keys', 'preventExtensions', 'seal', 'setPrototypeOf', 'toString',
  'valueOf', 'values',
  
  // Array methods
  'concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
  'indexOf', 'join', 'lastIndexOf', 'map', 'pop', 'push', 'reduce',
  'reduceRight', 'reverse', 'shift', 'slice', 'some', 'sort', 'splice',
  'unshift', 'fill', 'copyWithin', 'flat', 'flatMap',
  
  // String methods
  'charAt', 'charCodeAt', 'codePointAt', 'endsWith', 'includes', 'indexOf',
  'lastIndexOf', 'localeCompare', 'match', 'normalize', 'padEnd', 'padStart',
  'repeat', 'replace', 'search', 'slice', 'split', 'startsWith', 'substring',
  'toLocaleLowerCase', 'toLocaleUpperCase', 'toLowerCase', 'toUpperCase',
  'trim', 'trimEnd', 'trimStart', 'toLocaleDateString', 'toLocaleString',
  
  // Number methods
  'toExponential', 'toFixed', 'toPrecision',
  
  // Promise methods
  'then', 'catch', 'finally', 'all', 'race', 'resolve', 'reject', 'allSettled',
  
  // Console methods
  'log', 'error', 'warn', 'info', 'debug', 'trace', 'assert', 'clear',
  'count', 'dir', 'dirxml', 'group', 'groupEnd', 'table', 'time', 'timeEnd',
  
  // Error types
  'Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError',
  'EvalError', 'URIError', 'AggregateError',
  
  // Common error class names (from your logs)
  'ValidationError', 'NotFoundError', 'UnauthorizedError', 'ConflictError',
  
  // TypeScript utility types and keywords
  'undefined', 'null', 'void', 'never', 'unknown', 'any', 'boolean',
  'number', 'string', 'symbol', 'object', 'bigint',
  
  // Common library methods that aren't InversifyJS
  'emit', 'on', 'off', 'once', 'removeListener', 'addListener',
  'delete', 'update', 'save', 'load', 'fetch', 'send', 'receive',
  'validate', 'sanitize', 'parse', 'stringify',
  
  // DOM/Browser methods (in case used in frontend code)
  'getElementById', 'getElementsByClassName', 'getElementsByTagName',
  'querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener',
  'appendChild', 'removeChild', 'insertBefore', 'replaceChild',
  
  // Node.js common methods
  'require', 'exports', 'module', '__dirname', '__filename',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'setImmediate', 'clearImmediate', 'process', 'Buffer',
  
  // Testing frameworks
  'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach',
  'beforeAll', 'afterAll', 'jest', 'mock', 'spy',
  
  // InversifyJS itself (we don't want to navigate to these)
  'inject', 'injectable', 'Container', 'bind', 'to', 'toSelf',
  'toConstantValue', 'toDynamicValue', 'toConstructor', 'toFactory',
  'toFunction', 'toProvider', 'toService', 'inSingletonScope',
  'inTransientScope', 'inRequestScope', 'when', 'whenTargetNamed',
  'whenTargetTagged', 'whenInjectedInto', 'whenParentNamed',
  'whenParentTagged', 'whenAnyAncestorIs', 'whenNoAncestorIs'
]);

// Patterns that indicate an identifier is likely not an InversifyJS service
const EXCLUDED_PATTERNS = [
  /^_/,                    // Private convention (starts with underscore)
  /^[A-Z_]+$/,            // All caps (likely constants, not services)
  /^[a-z]$/,              // Single letter variables
  /^\d/,                  // Starts with number (invalid identifier but just in case)
];

/**
 * Check if an identifier is a built-in JavaScript/TypeScript identifier
 */
export function isBuiltInIdentifier(identifier: string): boolean {
  return BUILT_IN_IDENTIFIERS.has(identifier);
}

/**
 * Check if an identifier should be excluded based on patterns
 */
export function shouldExcludeIdentifier(identifier: string): boolean {
  // Check if it's a built-in
  if (isBuiltInIdentifier(identifier)) {
    return true;
  }
  
  // Check against exclusion patterns
  for (const pattern of EXCLUDED_PATTERNS) {
    if (pattern.test(identifier)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if an identifier looks like it could be an InversifyJS token
 */
export function looksLikeInversifyToken(identifier: string): boolean {
  // Common InversifyJS token patterns
  if (identifier.startsWith('TYPES.')) {
    return true;
  }
  
  if (identifier.startsWith('SERVICE_IDENTIFIER.')) {
    return true;
  }
  
  if (identifier.startsWith('TAGS.')) {
    return true;
  }
  
  // Symbol tokens often have specific patterns
  if (identifier.includes('Service') || 
      identifier.includes('Repository') || 
      identifier.includes('Controller') ||
      identifier.includes('Factory') ||
      identifier.includes('Provider') ||
      identifier.includes('Manager') ||
      identifier.includes('Handler')) {
    return true;
  }
  
  return false;
}

/**
 * Main filter function to determine if an identifier should be processed
 */
export function shouldProcessIdentifier(identifier: string): boolean {
  // Quick rejection for built-ins and excluded patterns
  if (shouldExcludeIdentifier(identifier)) {
    return false;
  }
  
  // Accept if it looks like an InversifyJS token
  if (looksLikeInversifyToken(identifier)) {
    return true;
  }
  
  // For property access (e.g., this.someService), we'll need context
  // This will be handled by the InjectedPropertyTracker
  
  return true; // Default to true, but InjectedPropertyTracker will do final filtering
}