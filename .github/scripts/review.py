#!/usr/bin/env python3
"""
AI Code Review Bot
按照 dev-style 规范审查 PR 代码
"""

import argparse
import os
import sys
import json
import requests
from pathlib import Path


# dev-style 核心规范摘要
REVIEW_GUIDELINES = """
## Code Review Checklist (dev-style)

### 一、逻辑正确性（最重要）
- 代码是否实现了需求功能？
- 边界条件是否处理？（空值、极端输入、并发场景）
- 异常情况是否正确处理？
- 有没有明显的 bug 或逻辑漏洞？
- 数据一致性是否保证？（事务、锁）

### 二、代码风格与优雅度
- 命名是否清晰表达意图？（变量/函数名用英文，避免缩写）
- 函数是否职责单一、长度合理？（不超过 50 行）
- 嵌套层级是否过深？（≤ 3 层）
- 有没有重复代码可以抽取？
- 分层是否清晰？（Controller/Service/Repository 混用？）
- 有没有"坏味道"？（魔法数字、过长参数列表、过大类）

### 三、可维护性
- 关键逻辑是否有必要注释？（注释用中文）
- 代码是否容易理解和修改？
- 依赖关系是否清晰、合理？

### 四、安全与性能
- SQL 注入 / XSS / 敏感信息泄露风险？
- 有没有明显的性能问题？（N+1 查询、循环内调用外部服务）

### 五、代码质量红线（绝对禁止）
- 深层嵌套（超过 3 层）
- 单个函数超过 50 行
- 魔法数字（应使用常量）
- 未处理的异常吞掉
- 注释掉的代码提交
- 复制粘贴代码（超 3 行重复考虑抽函数）

### 六、命名规范
- 变量/参数：Python 用 snake_case，JS/Java 用 camelCase
- 常量：UPPER_SNAKE_CASE
- 函数/方法：动词开头
- 类/接口：PascalCase
- 布尔变量：is/has/can 前缀

### 七、异常处理
- 使用早返回（Guard Clause）减少嵌套
- 业务错误：用返回值或特定异常
- 系统错误：用异常
"""


def get_diff(diff_file: str) -> str:
    """读取 PR diff"""
    with open(diff_file, 'r', encoding='utf-8') as f:
        return f.read()


def call_llm(api_key: str, api_base: str, model: str, prompt: str) -> str:
    """调用 LLM API 进行代码审查"""
    
    # 默认使用 OpenAI 兼容 API
    if not api_base:
        api_base = "https://api.openai.com/v1"
    if not model:
        model = "gpt-4o"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": f"""你是一位资深代码审查专家，请严格按照以下规范审查代码：

{REVIEW_GUIDELINES}

请用中文回复，格式清晰，指出具体问题和改进建议。"""
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.3,
        "max_tokens": 4000
    }
    
    try:
        response = requests.post(
            f"{api_base}/chat/completions",
            headers=headers,
            json=payload,
            timeout=60
        )
        response.raise_for_status()
        result = response.json()
        return result["choices"][0]["message"]["content"]
    except Exception as e:
        return f"## AI Review Error\n\n调用 LLM API 失败: {str(e)}"


def review_diff(diff: str) -> str:
    """审查代码差异"""
    
    # 限制 diff 长度，避免 token 超限
    max_diff_length = 15000
    if len(diff) > max_diff_length:
        diff = diff[:max_diff_length] + "\n\n... (diff 过长，已截断)"
    
    prompt = f"""请审查以下 PR 代码变更，按照 dev-style 规范给出评审意见：

```diff
{diff}
```

请按以下格式输出评审结果：

## AI Code Review

### 总体评价
[简要说明代码质量总体情况：良好/需改进/有问题]

### 具体问题
[按文件列出发现的问题，格式：`文件名:行号 问题描述`]

### 改进建议
[给出具体的改进建议]

### Checklist 通过情况
- [ ] 逻辑正确性
- [ ] 代码风格
- [ ] 可维护性
- [ ] 安全与性能

如果代码质量很好，可以简短说明"代码质量良好，无重大问题"。
"""
    
    return prompt


def main():
    parser = argparse.ArgumentParser(description="AI Code Review Bot")
    parser.add_argument("--diff-file", required=True, help="PR diff 文件路径")
    parser.add_argument("--pr-number", required=True, help="PR 编号")
    parser.add_argument("--repo", required=True, help="仓库名 (owner/repo)")
    parser.add_argument("--github-token", help="GitHub Token (用于 API 调用)")
    args = parser.parse_args()
    
    # 读取环境变量
    api_key = os.environ.get("LLM_API_KEY", "")
    api_base = os.environ.get("LLM_API_BASE", "")
    model = os.environ.get("LLM_MODEL", "")
    
    if not api_key:
        print("Error: LLM_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    
    # 读取 diff
    diff = get_diff(args.diff_file)
    
    if not diff.strip():
        print("No diff to review")
        result = "## AI Code Review\n\nPR 没有代码变更，无需审查。"
    else:
        # 生成审查 prompt
        prompt = review_diff(diff)
        
        # 调用 LLM
        print(f"Calling LLM ({model or 'default'}) for review...")
        result = call_llm(api_key, api_base, model, prompt)
    
    # 保存结果
    output_path = "/tmp/review_result.md"
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(result)
    
    print(f"Review saved to {output_path}")


if __name__ == "__main__":
    main()