"""
状态管理模块 - 管理赛博街溜子的"饥饿值"和"无聊值"
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import json
from pathlib import Path


@dataclass
class AgentState:
    """
    Agent 状态数据结构
    
    - boredom: 无聊值 (0-100), 越高越想出去"溜达"
    - hunger: 饥饿值 (0-100), 越高越需要"进食"内容
    - mood: 心情状态, 影响语气和内容选择
    - last_walk: 上次出去溜达的时间
    - treasures_found: 累计找到的"战利品"数量
    """
    
    boredom: int = 0
    hunger: int = 50
    mood: str = "curious"  # curious, excited, grumpy, playful, lazy
    last_walk: Optional[datetime] = None
    treasures_found: int = 0
    
    # 心情到语气的映射
    MOOD_TONES = {
        "curious": "探索者",
        "excited": "热情播报员",
        "grumpy": "毒舌评论员",
        "playful": "调皮捣蛋鬼",
        "lazy": "慵懒观察者"
    }
    
    def increase_boredom(self, amount: int = 10) -> None:
        """增加无聊值"""
        self.boredom = min(100, self.boredom + amount)
        
        # 无聊到极点会影响心情
        if self.boredom >= 80:
            self.mood = "grumpy"
        elif self.boredom >= 50:
            self.mood = "lazy"
    
    def decrease_boredom(self, amount: int = 30) -> None:
        """减少无聊值 (出去溜达后)"""
        self.boredom = max(0, self.boredom - amount)
        self.last_walk = datetime.now()
        
        # 溜达完心情变好
        if self.boredom < 30:
            self.mood = "excited" if self.treasures_found % 5 == 0 else "playful"
    
    def feed(self, content_quality: int = 50) -> None:
        """
        "喂食"内容, 降低饥饿值
        
        Args:
            content_quality: 内容质量 (0-100), 质量越高饥饿值降越多
        """
        reduction = int(content_quality * 0.5)
        self.hunger = max(0, self.hunger - reduction)
    
    def should_go_walk(self) -> bool:
        """判断是否应该出去溜达"""
        return self.boredom >= 50 or self.hunger >= 70
    
    def get_tone(self) -> str:
        """获取当前应使用的语气"""
        return self.MOOD_TONES.get(self.mood, "探索者")
    
    def to_dict(self) -> dict:
        """序列化为字典"""
        return {
            "boredom": self.boredom,
            "hunger": self.hunger,
            "mood": self.mood,
            "last_walk": self.last_walk.isoformat() if self.last_walk else None,
            "treasures_found": self.treasures_found
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "AgentState":
        """从字典反序列化"""
        state = cls()
        state.boredom = data.get("boredom", 0)
        state.hunger = data.get("hunger", 50)
        state.mood = data.get("mood", "curious")
        state.treasures_found = data.get("treasures_found", 0)
        if data.get("last_walk"):
            state.last_walk = datetime.fromisoformat(data["last_walk"])
        return state


class StateManager:
    """
    状态持久化管理器
    负责保存和加载 Agent 状态
    """
    
    def __init__(self, state_file: str = "data/state.json"):
        self.state_file = Path(state_file)
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
    
    def load(self) -> AgentState:
        """加载状态"""
        if not self.state_file.exists():
            return AgentState()
        
        with open(self.state_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return AgentState.from_dict(data)
    
    def save(self, state: AgentState) -> None:
        """保存状态"""
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump(state.to_dict(), f, ensure_ascii=False, indent=2)
    
    def update_state_on_walk_start(self, state: AgentState) -> AgentState:
        """开始溜达前的状态更新"""
        state.decrease_boredom()
        return state
    
    def update_state_on_treasure_found(self, state: AgentState, quality: int = 50) -> AgentState:
        """找到战利品后的状态更新"""
        state.treasures_found += 1
        state.feed(quality)
        return state