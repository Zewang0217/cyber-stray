"""
赛博街溜子 Agent 核心逻辑
"""

from dataclasses import dataclass
from typing import List, Optional
import asyncio
import random

from .state import AgentState, StateManager
from .tools import Treasure, DuckDuckGoSearch, TopicGenerator
from .notifier import NotifierManager, Message


@dataclass
class WalkResult:
    """溜达结果"""
    treasures: List[Treasure]
    message_sent: bool
    state: AgentState


class CyberStrayAgent:
    """
    赛博街溜子 Agent
    
    核心行为:
    1. 检查状态 (无聊值/饥饿值)
    2. 决定是否出去溜达
    3. 生成话题, 搜索内容
    4. 筛选和评分
    5. 生成推送消息
    6. 更新状态
    """
    
    def __init__(
        self,
        state_manager: StateManager,
        search_tool: DuckDuckGoSearch,
        notifier_manager: NotifierManager,
        topic_generator: TopicGenerator
    ):
        self.state_manager = state_manager
        self.search_tool = search_tool
        self.notifier = notifier_manager
        self.topic_generator = topic_generator
        self.state: Optional[AgentState] = None
    
    async def initialize(self) -> None:
        """初始化 Agent, 加载状态"""
        self.state = self.state_manager.load()
    
    async def check_and_act(self) -> Optional[WalkResult]:
        """
        检查状态并决定是否行动
        
        Returns:
            如果执行了溜达, 返回结果; 否则返回 None
        """
        if self.state is None:
            await self.initialize()
        
        # 检查是否需要出去溜达
        if not self.state.should_go_walk():
            # 无聊值自然增长
            self.state.increase_boredom(5)
            self.state_manager.save(self.state)
            return None
        
        # 出去溜达!
        return await self.go_for_a_walk()
    
    async def go_for_a_walk(self) -> WalkResult:
        """
        出去溜达, 搜罗内容
        """
        # 更新状态
        self.state = self.state_manager.update_state_on_walk_start(self.state)
        
        # 生成话题
        topic = self.topic_generator.generate_topic(self.state.mood)
        
        # 搜索
        treasures = await self.search_tool.search(topic, max_results=5)
        
        # 筛选和评分
        best_treasure = self._pick_best_treasure(treasures)
        
        # 生成消息并推送
        if best_treasure:
            message = await self._craft_message(best_treasure)
            results = await self.notifier.broadcast(message)
            message_sent = any("success" in str(v) for v in results.values())
            
            # 更新状态
            self.state = self.state_manager.update_state_on_treasure_found(
                self.state, 
                int(best_treasure.quality_score)
            )
        else:
            message_sent = False
            # 没找到好东西, 有点沮丧
            self.state.mood = "grumpy"
        
        # 保存状态
        self.state_manager.save(self.state)
        
        return WalkResult(
            treasures=treasures,
            message_sent=message_sent,
            state=self.state
        )
    
    def _pick_best_treasure(self, treasures: List[Treasure]) -> Optional[Treasure]:
        """
        从搜罗到的内容中挑选最好的
        """
        if not treasures:
            return None
        
        # TODO: 可以加入更多筛选逻辑
        # 比如去重、相关性评分、用户兴趣匹配等
        
        # 暂时随机选一个
        return random.choice(treasures)
    
    async def _craft_message(self, treasure: Treasure) -> Message:
        """
        根据战利品和当前心情生成推送消息
        
        TODO: 接入 LLM 生成更有趣的文案
        """
        tone = self.state.get_tone()
        
        # 语气模板
        templates = {
            "探索者": f"我在赛博空间溜达时发现了这个:\n\n📰 {treasure.title}\n\n{treasure.snippet}",
            "热情播报员": f"⚠️ 重磅发现 ⚠️\n\n{treasure.title}\n\n{treasure.snippet}\n\n快去看看吧!",
            "毒舌评论员": f"又是一个无聊的发现...\n\n{treasure.title}\n\n{treasure.snippet}\n\n(虽然无聊但还是发给你了)",
            "调皮捣蛋鬼": f"嘿嘿嘿~ 看我找到了什么~\n\n{treasure.title}\n\n{treasure.snippet}",
            "慵懒观察者": f"摸鱼中... 顺便发现...\n\n{treasure.title}\n\n{treasure.snippet}\n\n继续睡了..."
        }
        
        content = templates.get(tone, templates["探索者"])
        
        return Message(
            title=f"🐕 赛博街溜子发现",
            content=content,
            url=treasure.url,
            tone=tone
        )
    
    async def force_walk(self) -> WalkResult:
        """
        强制出去溜达 (无视状态)
        """
        if self.state is None:
            await self.initialize()
        
        return await self.go_for_a_walk()