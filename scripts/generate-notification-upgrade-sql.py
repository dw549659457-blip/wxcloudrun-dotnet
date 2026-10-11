#!/usr/bin/env python3
"""Generate a guarded installer for upgrading an existing 001-005 business database."""
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'database' / 'wechat-cloudrun-upgrade-006.sql'
MIGRATION = ROOT / 'database' / 'migrations' / '006_stock_notifications.sql'


def generate():
    sql = MIGRATION.read_bytes().decode('utf-8-sig')
    checksum = hashlib.sha256(sql.encode()).hexdigest().upper()
    prior = sorted(MIGRATION.parent.glob('00[1-5]_*.sql'))
    matches = ' OR '.join(
        f"(Name='{file.name}' AND Checksum='{hashlib.sha256(file.read_bytes()).hexdigest().upper()}')"
        for file in prior
    )
    return f"""-- 已有 vegetable_prod 业务库升级：管理员库存动态与微信订阅提醒。
-- 保留原 admin、其他账号、库存、单据及流水；不会创建会计账号或改密码。
-- 必须先完成 001-005；执行完此文件后再发布含 006 的新服务版本。
-- 如使用其他业务库，仅修改 USE；服务 MYSQL_DATABASE 必须匹配。
-- 支持重复执行：已登记且校验相同则跳过，不重置已读状态或微信订阅记录。
-- 执行器须支持 DELIMITER；MySQL DDL 不具备整份事务回滚。
-- 自动生成：python3 scripts/generate-notification-upgrade-sql.py
SET NAMES utf8mb4;
USE `vegetable_prod`;
DELIMITER $$
DROP PROCEDURE IF EXISTS `_codex_upgrade_notifications_006`$$
CREATE PROCEDURE `_codex_upgrade_notifications_006`()
BEGIN
  IF EXISTS (SELECT 1 FROM SchemaMigrations WHERE Name='{MIGRATION.name}') THEN
    IF NOT EXISTS (SELECT 1 FROM SchemaMigrations WHERE Name='{MIGRATION.name}' AND Checksum='{checksum}') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Migration 006 checksum mismatch';
    END IF;
  ELSE
    IF (SELECT COUNT(*) FROM SchemaMigrations WHERE {matches}) <> {len(prior)} THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Apply unchanged migrations 001-005 before this upgrade';
    ELSEIF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('StockNotifications','StockNotificationReads','WechatNotificationPreferences','WechatNotificationGrants','WechatNotificationDeliveries')) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Partial upgrade detected; inspect tables before proceeding';
    ELSE
{sql}
      INSERT INTO SchemaMigrations VALUES ('{MIGRATION.name}','{checksum}',UTC_TIMESTAMP(6));
    END IF;
  END IF;
END$$
CALL `_codex_upgrade_notifications_006`()$$
DROP PROCEDURE `_codex_upgrade_notifications_006`$$
DELIMITER ;
SELECT Name,AppliedAt FROM SchemaMigrations ORDER BY Name;
SELECT COUNT(*) AS NotificationCount FROM StockNotifications;
""".encode()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    expected = generate()
    if args.check:
        if not TARGET.exists() or TARGET.read_bytes() != expected:
            raise SystemExit('Upgrade SQL is stale: run python3 scripts/generate-notification-upgrade-sql.py')
        print('Notification upgrade SQL matches migration files')
    else:
        TARGET.write_bytes(expected)
        print(f'Generated {TARGET.relative_to(ROOT)}')
