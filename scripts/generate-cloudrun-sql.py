#!/usr/bin/env python3
"""Generate the empty-database installer with MigrationRunner-compatible hashes."""
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "database" / "wechat-cloudrun-init.sql"


def generate():
    parts = ["""-- 微信云托管业务数据库首次初始化；默认库名 vegetable_prod。
-- 如需其他库名，同时修改下面 CREATE DATABASE、USE 和服务 MYSQL_DATABASE。
-- 用你已有的 root 账号登录数据库控制台，然后完整执行本文件。
-- 本文件不设置/更改 root 密码，不创建测试账号，不写入示例库存。
-- 仅允许空业务库；已有业务表时会报错退出，不删除或覆盖任何业务数据。
-- 执行器须支持 DELIMITER（例如 mysql 客户端或支持脚本模式的数据库工具）。
-- MySQL DDL 不支持整份回滚；中途失败时检查结构，不反复导入。
-- 自动生成：python3 scripts/generate-cloudrun-sql.py
SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS `vegetable_prod` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `vegetable_prod`;

DELIMITER $$
DROP PROCEDURE IF EXISTS `_codex_initialize_vegetable_v1`$$
CREATE PROCEDURE `_codex_initialize_vegetable_v1`()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Business database must be empty; use APP_COMMAND=migrate for existing databases';
  ELSE
    CREATE TABLE SchemaMigrations (
      Name VARCHAR(200) PRIMARY KEY, Checksum CHAR(64) NOT NULL, AppliedAt DATETIME(6) NOT NULL
    ) ENGINE=InnoDB;
"""]
    for file in sorted((ROOT / "database" / "migrations").glob("*.sql")):
        # File.ReadAllTextAsync in MigrationRunner decodes UTF-8 but retains line endings.
        sql = file.read_bytes().decode("utf-8-sig")
        checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest().upper()
        parts.append(f"\n-- {file.name}\n{sql}\n")
        parts.append(f"INSERT INTO SchemaMigrations (Name,Checksum,AppliedAt) VALUES ('{file.name}','{checksum}',UTC_TIMESTAMP(6));\n")
    parts.append("""
  END IF;
END$$
CALL `_codex_initialize_vegetable_v1`()$$
DROP PROCEDURE `_codex_initialize_vegetable_v1`$$
DELIMITER ;

SELECT Name, Checksum, AppliedAt FROM SchemaMigrations ORDER BY Name;
-- 业务管理员使用应用 APP_COMMAND=init-admin 初始化，密码由 PBKDF2 加密。
-- 设置 INITIAL_ADMIN_USERNAME 与 INITIAL_ADMIN_PASSWORD（12—128 字符）后运行一次，
-- 然后移除 APP_COMMAND 和 INITIAL_ADMIN_*，启动正常 API 服务。
""")
    return "".join(parts).encode("utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if generated SQL is stale")
    args = parser.parse_args()
    expected = generate()
    if args.check:
        if not TARGET.exists() or TARGET.read_bytes() != expected:
            raise SystemExit("SQL is stale: run python3 scripts/generate-cloudrun-sql.py")
        print("Cloudrun initialization SQL matches migration files")
    else:
        TARGET.write_bytes(expected)
        print(f"Generated {TARGET.relative_to(ROOT)}")
