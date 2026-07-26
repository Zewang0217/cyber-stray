/**
 * ToolManager - 统一管理所有 Agent 工具的注册、发现和元信息
 *
 * 设计目标：
 * 1. 单一入口：所有工具通过 ToolManager 注册和管理
 * 2. 声明式注册：工具定义自包含元信息 (metadata)
 * 3. 运行时控制：可动态启用/禁用工具
 * 4. Prompt 友好：统一获取工具元信息用于 Prompt 生成
 */

import type { Tool } from 'ai';
import type { ToolContext } from './registry/context.js';

/** 工具元信息（用于 Prompt 生成） */
export interface ToolMetadata {
  name: string;
  description: string;
  category?: 'search' | 'web' | 'content' | 'memory' | 'feedback' | 'browser';
  enabled?: boolean;
}

/** 工具定义（包含元信息 + 执行器工厂） */
export interface ToolDefinition {
  metadata: ToolMetadata;
  createTool: (ctx: ToolContext) => Tool;
}

/** 工具统计信息 */
export interface ToolStats {
  total: number;
  enabled: number;
  disabled: number;
  byCategory: Record<string, number>;
}

export class ToolManager {
  private static registry = new Map<string, ToolDefinition>();
  private static enabledSet = new Set<string>();
  private static initialized = false;

  /**
   * 注册单个工具
   */
  static register(def: ToolDefinition): void {
    if (this.registry.has(def.metadata.name)) {
      console.warn(`[ToolManager] 工具 ${def.metadata.name} 已存在，将被覆盖`);
    }
    this.registry.set(def.metadata.name, def);
    if (def.metadata.enabled !== false) {
      this.enabledSet.add(def.metadata.name);
    }
  }

  /**
   * 批量注册工具
   */
  static batchRegister(defs: ToolDefinition[]): void {
    for (const def of defs) {
      this.register(def);
    }
  }

  /**
   * 设置工具启用/禁用状态
   */
  static setEnabled(name: string, enabled: boolean): void {
    if (enabled) {
      this.enabledSet.add(name);
    } else {
      this.enabledSet.delete(name);
    }
  }

  /**
   * 检查工具是否启用
   */
  static isEnabled(name: string): boolean {
    return this.enabledSet.has(name);
  }

  /**
   * 获取所有工具元信息
   */
  static getMetadata(enabledOnly = false): ToolMetadata[] {
    const all = Array.from(this.registry.values()).map((def) => ({
      ...def.metadata,
      enabled: this.enabledSet.has(def.metadata.name),
    }));

    if (enabledOnly) {
      return all.filter((m) => m.enabled);
    }
    return all;
  }

  /**
   * 获取指定工具的元信息
   */
  static getMetadataByName(name: string): ToolMetadata | undefined {
    const def = this.registry.get(name);
    if (!def) return undefined;
    return {
      ...def.metadata,
      enabled: this.enabledSet.has(name),
    };
  }

  /**
   * 获取所有工具名称
   */
  static getToolNames(enabledOnly = false): string[] {
    if (enabledOnly) {
      return Array.from(this.enabledSet);
    }
    return Array.from(this.registry.keys());
  }

  /**
   * 获取工具统计信息
   */
  static getStats(): ToolStats {
    const all = this.getMetadata();
    const byCategory: Record<string, number> = {};

    for (const tool of all) {
      const cat = tool.category ?? 'other';
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }

    return {
      total: all.length,
      enabled: all.filter((m) => m.enabled).length,
      disabled: all.filter((m) => !m.enabled).length,
      byCategory,
    };
  }

  /**
   * 获取已实例化的工具集（用于 AI SDK）
   */
  static getTools(ctx: ToolContext): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    for (const name of this.enabledSet) {
      const def = this.registry.get(name);
      if (def) {
        tools[name] = def.createTool(ctx);
      }
    }
    return tools;
  }

  /**
   * 获取指定工具（支持过滤）
   */
  static getToolsFiltered(
    ctx: ToolContext,
    options?: { only?: string[]; exclude?: string[] }
  ): Record<string, Tool> {
    const all = this.getTools(ctx);

    if (options?.exclude?.length) {
      for (const name of options.exclude) {
        delete all[name];
      }
    }

    if (options?.only?.length) {
      const filtered: Record<string, Tool> = {};
      for (const name of options.only) {
        if (all[name]) {
          filtered[name] = all[name];
        }
      }
      return filtered;
    }

    return all;
  }

  /**
   * 初始化工具注册表
   * 启动时调用，加载所有工具定义
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return;

    const { registerAllTools } = await import('./registry/auto-register.js');
    await registerAllTools();
    this.initialized = true;

    const stats = this.getStats();
    console.log(`[ToolManager] 初始化完成，${stats.enabled}/${stats.total} 个工具已启用`);
  }

  /**
   * 检查是否已初始化
   */
  static isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 重置工具管理器（用于测试）
   */
  static reset(): void {
    this.registry.clear();
    this.enabledSet.clear();
    this.initialized = false;
  }
}