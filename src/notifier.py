"""
消息推送模块 - 支持多平台推送
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, List
import aiohttp


@dataclass
class Message:
    """推送消息结构"""
    content: str
    title: Optional[str] = None
    url: Optional[str] = None
    tone: str = "default"  # 语气类型


class Notifier(ABC):
    """推送器抽象基类"""
    
    @abstractmethod
    async def send(self, message: Message) -> bool:
        """发送消息"""
        pass


class TelegramNotifier(Notifier):
    """Telegram Bot 推送"""
    
    def __init__(self, bot_token: str, chat_id: str):
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.api_url = f"https://api.telegram.org/bot{bot_token}"
    
    async def send(self, message: Message) -> bool:
        """
        发送 Telegram 消息
        
        TODO: 实际实现
        """
        text = self._format_message(message)
        
        async with aiohttp.ClientSession() as session:
            url = f"{self.api_url}/sendMessage"
            payload = {
                "chat_id": self.chat_id,
                "text": text,
                "parse_mode": "HTML"
            }
            async with session.post(url, json=payload) as resp:
                return resp.status == 200
    
    def _format_message(self, message: Message) -> str:
        """格式化消息"""
        parts = []
        
        if message.title:
            parts.append(f"<b>{message.title}</b>")
        
        parts.append(message.content)
        
        if message.url:
            parts.append(f'\n<a href="{message.url}">查看详情</a>')
        
        return "\n".join(parts)


class WeChatNotifier(Notifier):
    """Server酱微信推送"""
    
    def __init__(self, send_key: str):
        self.send_key = send_key
        self.api_url = f"https://sctapi.ftqq.com/{send_key}.send"
    
    async def send(self, message: Message) -> bool:
        """
        发送微信消息
        
        TODO: 实际实现
        """
        async with aiohttp.ClientSession() as session:
            payload = {
                "title": message.title or "赛博街溜子发来贺电",
                "desp": message.content
            }
            async with session.post(self.api_url, data=payload) as resp:
                return resp.status == 200


class FeishuNotifier(Notifier):
    """飞书机器人推送"""
    
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url
    
    async def send(self, message: Message) -> bool:
        """
        发送飞书消息
        
        TODO: 实际实现
        """
        async with aiohttp.ClientSession() as session:
            payload = {
                "msg_type": "text",
                "content": {
                    "text": message.content
                }
            }
            async with session.post(self.webhook_url, json=payload) as resp:
                return resp.status == 200


class NotifierManager:
    """
    推送管理器 - 管理多个推送渠道
    """
    
    def __init__(self):
        self.notifiers: List[Notifier] = []
    
    def add_notifier(self, notifier: Notifier) -> None:
        """添加推送渠道"""
        self.notifiers.append(notifier)
    
    async def broadcast(self, message: Message) -> dict:
        """
        向所有渠道广播消息
        
        Returns:
            各渠道发送结果
        """
        results = {}
        for i, notifier in enumerate(self.notifiers):
            try:
                success = await notifier.send(message)
                results[f"notifier_{i}"] = "success" if success else "failed"
            except Exception as e:
                results[f"notifier_{i}"] = f"error: {str(e)}"
        
        return results