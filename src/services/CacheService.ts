import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Binding, InjectionMapping } from '../types';

export interface CacheData {
    version: string;
    timestamp: number;
    bindings: Map<string, Binding[]>;
    injections: Map<string, InjectionMapping>;
    scannedFiles: string[];
    configHash?: string;
}

export class CacheService {
    private static readonly CACHE_VERSION = '1.0.0';
    private static readonly CACHE_DIR = '.inverigator';
    private static readonly BINDINGS_CACHE_FILE = 'bindings.json';
    private static readonly INJECTIONS_CACHE_FILE = 'injections.json';
    private static readonly METADATA_FILE = 'metadata.json';

    constructor(
        private workspaceRoot: string,
        private outputChannel: vscode.OutputChannel
    ) {}

    private getCachePath(): string {
        return path.join(this.workspaceRoot, CacheService.CACHE_DIR);
    }

    private getBindingsCachePath(): string {
        return path.join(this.getCachePath(), CacheService.BINDINGS_CACHE_FILE);
    }

    private getInjectionsCachePath(): string {
        return path.join(this.getCachePath(), CacheService.INJECTIONS_CACHE_FILE);
    }

    private getMetadataPath(): string {
        return path.join(this.getCachePath(), CacheService.METADATA_FILE);
    }

    private ensureCacheDir(): void {
        const cachePath = this.getCachePath();
        if (!fs.existsSync(cachePath)) {
            fs.mkdirSync(cachePath, { recursive: true });
            this.outputChannel.appendLine(`Created cache directory: ${cachePath}`);
        }
    }

    public async saveCache(
        bindings: Map<string, Binding[]>,
        injections: Map<string, InjectionMapping>,
        scannedFiles: string[]
    ): Promise<void> {
        try {
            this.ensureCacheDir();

            // Convert Maps to serializable format
            const bindingsObj: Record<string, Binding[]> = {};
            bindings.forEach((value, key) => {
                bindingsObj[key] = value;
            });

            const injectionsObj: Record<string, InjectionMapping> = {};
            injections.forEach((value, key) => {
                injectionsObj[key] = value;
            });

            // Save bindings
            await fs.promises.writeFile(
                this.getBindingsCachePath(),
                JSON.stringify(bindingsObj, null, 2),
                'utf8'
            );

            // Save injections
            await fs.promises.writeFile(
                this.getInjectionsCachePath(),
                JSON.stringify(injectionsObj, null, 2),
                'utf8'
            );

            // Save metadata
            const metadata = {
                version: CacheService.CACHE_VERSION,
                timestamp: Date.now(),
                scannedFiles: scannedFiles,
                bindingsCount: bindings.size,
                injectionsCount: injections.size,
                configHash: await this.getConfigHash()
            };

            await fs.promises.writeFile(
                this.getMetadataPath(),
                JSON.stringify(metadata, null, 2),
                'utf8'
            );

            this.outputChannel.appendLine(`Cache saved: ${bindings.size} bindings, ${injections.size} injections`);
        } catch (error) {
            this.outputChannel.appendLine(`Failed to save cache: ${error}`);
            throw error;
        }
    }

    public async loadCache(): Promise<CacheData | null> {
        try {
            const cachePath = this.getCachePath();
            if (!fs.existsSync(cachePath)) {
                this.outputChannel.appendLine('Cache directory does not exist');
                return null;
            }

            // Check if all cache files exist
            if (!fs.existsSync(this.getBindingsCachePath()) ||
                !fs.existsSync(this.getInjectionsCachePath()) ||
                !fs.existsSync(this.getMetadataPath())) {
                this.outputChannel.appendLine('Cache files are incomplete');
                return null;
            }

            // Load metadata
            const metadataContent = await fs.promises.readFile(this.getMetadataPath(), 'utf8');
            const metadata = JSON.parse(metadataContent);

            // Check cache version
            if (metadata.version !== CacheService.CACHE_VERSION) {
                this.outputChannel.appendLine(`Cache version mismatch: ${metadata.version} vs ${CacheService.CACHE_VERSION}`);
                return null;
            }

            // Check if configuration has changed
            const currentConfigHash = await this.getConfigHash();
            if (metadata.configHash !== currentConfigHash) {
                this.outputChannel.appendLine('Configuration has changed, cache invalidated');
                return null;
            }

            // Load bindings
            const bindingsContent = await fs.promises.readFile(this.getBindingsCachePath(), 'utf8');
            const bindingsObj = JSON.parse(bindingsContent);
            const bindings = new Map<string, Binding[]>(Object.entries(bindingsObj));

            // Load injections
            const injectionsContent = await fs.promises.readFile(this.getInjectionsCachePath(), 'utf8');
            const injectionsObj = JSON.parse(injectionsContent);
            const injections = new Map<string, InjectionMapping>(Object.entries(injectionsObj));

            this.outputChannel.appendLine(`Cache loaded: ${bindings.size} bindings, ${injections.size} injections`);

            return {
                version: metadata.version,
                timestamp: metadata.timestamp,
                bindings,
                injections,
                scannedFiles: metadata.scannedFiles || [],
                configHash: metadata.configHash
            };
        } catch (error) {
            this.outputChannel.appendLine(`Failed to load cache: ${error}`);
            return null;
        }
    }

    public async clearCache(): Promise<void> {
        try {
            const cachePath = this.getCachePath();
            if (fs.existsSync(cachePath)) {
                await fs.promises.rm(cachePath, { recursive: true, force: true });
                this.outputChannel.appendLine('Cache cleared');
            }
        } catch (error) {
            this.outputChannel.appendLine(`Failed to clear cache: ${error}`);
            throw error;
        }
    }

    public async isCacheValid(maxAge?: number): Promise<boolean> {
        try {
            const metadata = await this.loadMetadata();
            if (!metadata) {
                return false;
            }

            // Check if cache is too old
            if (maxAge) {
                const age = Date.now() - metadata.timestamp;
                if (age > maxAge) {
                    this.outputChannel.appendLine(`Cache is too old: ${age}ms > ${maxAge}ms`);
                    return false;
                }
            }

            // Check if configuration has changed
            const currentConfigHash = await this.getConfigHash();
            if (metadata.configHash !== currentConfigHash) {
                this.outputChannel.appendLine('Configuration has changed, cache is invalid');
                return false;
            }

            return true;
        } catch (error) {
            this.outputChannel.appendLine(`Failed to validate cache: ${error}`);
            return false;
        }
    }

    private async loadMetadata(): Promise<any | null> {
        try {
            if (!fs.existsSync(this.getMetadataPath())) {
                return null;
            }
            const content = await fs.promises.readFile(this.getMetadataPath(), 'utf8');
            return JSON.parse(content);
        } catch (error) {
            return null;
        }
    }

    private async getConfigHash(): Promise<string> {
        try {
            const config = vscode.workspace.getConfiguration('inverigator');
            const containerPaths = config.get<string[]>('containerPaths', []);
            const maxScanDepth = config.get<number>('maxScanDepth', 5);
            
            // Create a hash of configuration that affects scanning
            const configString = JSON.stringify({
                containerPaths,
                maxScanDepth
            });
            
            // Simple hash function
            let hash = 0;
            for (let i = 0; i < configString.length; i++) {
                const char = configString.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            
            return hash.toString(36);
        } catch (error) {
            return 'unknown';
        }
    }

    public async invalidateCache(files?: string[]): Promise<void> {
        if (!files || files.length === 0) {
            // Full cache invalidation
            await this.clearCache();
        } else {
            // Partial invalidation - for future enhancement
            // For now, we'll do a full invalidation
            await this.clearCache();
        }
    }

    public async cacheExists(): Promise<boolean> {
        try {
            const cachePath = this.getCachePath();
            if (!fs.existsSync(cachePath)) {
                return false;
            }
            
            // Check if all required cache files exist
            return fs.existsSync(this.getBindingsCachePath()) &&
                   fs.existsSync(this.getInjectionsCachePath()) &&
                   fs.existsSync(this.getMetadataPath());
        } catch (error) {
            return false;
        }
    }
    
    public async getCacheStats(): Promise<{
        exists: boolean;
        age?: number;
        bindingsCount?: number;
        injectionsCount?: number;
        size?: number;
    }> {
        try {
            const metadata = await this.loadMetadata();
            if (!metadata) {
                return { exists: false };
            }

            const stats = {
                exists: true,
                age: Date.now() - metadata.timestamp,
                bindingsCount: metadata.bindingsCount || 0,
                injectionsCount: metadata.injectionsCount || 0,
                size: 0
            };

            // Calculate cache size
            const cachePath = this.getCachePath();
            if (fs.existsSync(cachePath)) {
                const files = await fs.promises.readdir(cachePath);
                for (const file of files) {
                    const filePath = path.join(cachePath, file);
                    const fileStat = await fs.promises.stat(filePath);
                    stats.size += fileStat.size;
                }
            }

            return stats;
        } catch (error) {
            return { exists: false };
        }
    }
}