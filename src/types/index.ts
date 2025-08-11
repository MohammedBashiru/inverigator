export interface Binding {
  token: string;
  implementation: string;
  file: string;
  line: number;
}

export interface ServiceInfo {
  className: string;
  methods: string[];
  file: string;
}

export interface ScanOptions {
  patterns: string[];
  maxDepth: number;
}

export interface NavigationResult {
  success: boolean;
  targetFile?: string;
  targetLine?: number;
}

export type BindingsMap = Map<string, Binding[]>;
export type ServiceMap = Map<string, ServiceInfo>;