-- ADR-0010（#263）：微信 iLink 通道判死，删码后清表。
-- 实测绑定数据（主人扫码测试，个位数行）随表删除；FK 对 tenants 为
-- ON DELETE cascade，drop 表不影响租户本体。tenant_secrets 密文 blob 中
-- 残留的 ilink_bot_token 不清理（对已死端点无价值，拍板记录见 #263）。
DROP TABLE IF EXISTS `wechat_bindings`;
