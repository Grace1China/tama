import fs from 'fs';
import path from 'path';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

/**
 * 缓存管理器
 * 使用内存缓存 + 文件系统缓存的双层缓存策略
 */
class CacheManager {
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private cacheDir: string;

  constructor() {
    // 缓存目录：项目根目录下的 .cache 文件夹
    this.cacheDir = path.join(process.cwd(), '.cache');
    
    // 确保缓存目录存在
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 获取缓存键对应的文件路径
   */
  private getCacheFilePath(key: string): string {
    // 使用安全的文件名（替换特殊字符）
    const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');
    return path.join(this.cacheDir, `${safeKey}.json`);
  }

  /**
   * 从文件系统加载缓存
   */
  private loadFromFile<T>(key: string): CacheEntry<T> | null {
    try {
      const filePath = this.getCacheFilePath(key);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(fileContent);
      
      // 检查是否过期
      if (Date.now() > entry.expiresAt) {
        // 缓存已过期，删除文件
        fs.unlinkSync(filePath);
        return null;
      }

      return entry;
    } catch (error) {
      console.error(`[Cache] Error loading cache from file for key ${key}:`, error);
      return null;
    }
  }

  /**
   * 保存缓存到文件系统
   */
  private saveToFile<T>(key: string, entry: CacheEntry<T>): void {
    try {
      const filePath = this.getCacheFilePath(key);
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[Cache] Error saving cache to file for key ${key}:`, error);
    }
  }

  /**
   * 获取缓存
   * @param key 缓存键
   * @returns 缓存数据，如果不存在或已过期则返回null
   */
  get<T>(key: string): T | null {
    // 1. 先检查内存缓存
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry) {
      if (Date.now() > memoryEntry.expiresAt) {
        // 内存缓存已过期
        this.memoryCache.delete(key);
      } else {
        return memoryEntry.data as T;
      }
    }

    // 2. 检查文件系统缓存
    const fileEntry = this.loadFromFile<T>(key);
    if (fileEntry) {
      // 加载到内存缓存
      this.memoryCache.set(key, fileEntry);
      return fileEntry.data;
    }

    return null;
  }

  /**
   * 设置缓存
   * @param key 缓存键
   * @param data 要缓存的数据
   * @param ttlSeconds 缓存有效期（秒），默认3600秒（1小时）
   */
  set<T>(key: string, data: T, ttlSeconds: number = 3600): void {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      expiresAt: now + ttlSeconds * 1000,
    };

    // 同时保存到内存和文件系统
    this.memoryCache.set(key, entry);
    this.saveToFile(key, entry);
  }

  /**
   * 删除缓存
   */
  delete(key: string): void {
    this.memoryCache.delete(key);
    
    const filePath = this.getCacheFilePath(key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.memoryCache.clear();
    
    // 删除缓存目录下的所有文件
    try {
      const files = fs.readdirSync(this.cacheDir);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(this.cacheDir, file));
        }
      });
    } catch (error) {
      console.error('[Cache] Error clearing cache:', error);
    }
  }

  /**
   * 检查缓存是否存在且有效
   */
  has(key: string): boolean {
    // 检查内存缓存
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry && Date.now() <= memoryEntry.expiresAt) {
      return true;
    }

    // 检查文件系统缓存
    const fileEntry = this.loadFromFile(key);
    if (fileEntry) {
      // 加载到内存
      this.memoryCache.set(key, fileEntry);
      return true;
    }

    return false;
  }

  /**
   * 获取缓存剩余有效时间（秒）
   */
  getTTL(key: string): number {
    const entry = this.memoryCache.get(key) || this.loadFromFile(key);
    if (!entry) {
      return 0;
    }

    const remaining = entry.expiresAt - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
  }
}

// 导出单例实例
export const cache = new CacheManager();
