#!/usr/bin/env python3
"""
赛博街溜子 - 入口文件
"""

import asyncio
import argparse
import sys
from pathlib import Path

# 添加 src 到路径
sys.path.insert(0, str(Path(__file__).parent))

from src.agent import CyberStrayAgent
from src.state import StateManager
from src.tools import DuckDuckGoSearch, TopicGenerator
from src.notifier import NotifierManager


async def main():
    parser = argparse.ArgumentParser(description="赛博街溜子 - 自动化信息猎犬")
    parser.add_argument("--once", action="store_true", help="只执行一次后退出")
    parser.add_argument("--force", action="store_true", help="强制执行 (无视状态)")
    parser.add_argument("--daemon", action="store_true", help="以守护进程方式运行")
    args = parser.parse_args()
    
    # 初始化组件
    state_manager = StateManager("data/state.json")
    search_tool = DuckDuckGoSearch()
    notifier_manager = NotifierManager()
    topic_generator = TopicGenerator()
    
    # TODO: 根据配置文件初始化推送渠道
    
    # 创建 Agent
    agent = CyberStrayAgent(
        state_manager=state_manager,
        search_tool=search_tool,
        notifier_manager=notifier_manager,
        topic_generator=topic_generator
    )
    
    await agent.initialize()
    
    if args.force:
        # 强制执行
        result = await agent.force_walk()
        print(f"强制溜达完成: 找到 {len(result.treasures)} 个战利品, 消息发送: {result.message_sent}")
        
    elif args.once:
        # 单次执行
        result = await agent.check_and_act()
        if result:
            print(f"溜达完成: 找到 {len(result.treasures)} 个战利品")
        else:
            print("还没到溜达的时候...")
            
    elif args.daemon:
        # 守护进程模式
        print("赛博街溜子开始巡逻...")
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        
        scheduler = AsyncIOScheduler()
        scheduler.add_job(agent.check_and_act, 'interval', minutes=60)
        scheduler.start()
        
        try:
            await asyncio.Future()  # 永远运行
        except (KeyboardInterrupt, SystemExit):
            scheduler.shutdown()
            
    else:
        # 默认: 单次执行
        result = await agent.check_and_act()
        if result:
            print(f"溜达完成!")
        else:
            print("还没到溜达的时候...")


if __name__ == "__main__":
    asyncio.run(main())