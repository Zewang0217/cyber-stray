# Module 4: Skill 文件系统

## 父任务

`07-26-browser-exploration-mvp`（浏览器探索模块 MVP，Issue #44）

## 目标

`data/skills/` 下可创建、列出、加载 skill，遵循 agentskills.io 标准。

## 需求

1. **目录结构**：`data/skills/<name>/SKILL.md` + 可选 `references/` 子目录

2. **SkillParser** (`packages/agent/src/tools/browser/skills/parser.ts`)
   - 解析 YAML frontmatter（`name`、`description` 必填；`state` 预留，默认 `active`）+ Markdown 正文
   
3. **SkillIndex** (`packages/agent/src/tools/browser/skills/index.ts`)
   - 启动时扫描 `data/skills/`，构建 name → { name, description, filePath } 内存索引
   - 复用现有 memory JSON sidecar 索引模式（原子写、崩溃自愈、单例）

4. **Skill 工具**（3 个 ToolDefinition）
   - `browser_skill_list`：返回 name + description 列表（仅元数据）
   - `browser_skill_load`：读取 SKILL.md 全文
   - `browser_skill_create`：创建/更新 skill
     - name 格式：`[a-z0-9-]+`，max 64 字符
     - content max 10KB
     - 同名 → patch 路径（更新 SKILL.md 或添加 references/）
     - 即时刷新内存索引

5. **注册**到 `auto-register.ts`

6. **单元测试**

## 验收标准

- [ ] 手动创建 `data/skills/test-skill/SKILL.md` 后，`browser_skill_list` 能列出
- [ ] `browser_skill_load` 返回完整 frontmatter + 正文
- [ ] `browser_skill_create` 写入文件并刷新索引
- [ ] 同名 skill 走 patch 路径
- [ ] 无效 name 格式被拒绝
- [ ] 单元测试通过

## 依赖

无（Phase 1，可并行）
