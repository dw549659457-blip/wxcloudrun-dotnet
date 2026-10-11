-- 已有 vegetable_prod 业务库升级：管理员库存动态与微信订阅提醒。
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
  IF EXISTS (SELECT 1 FROM SchemaMigrations WHERE Name='006_stock_notifications.sql') THEN
    IF NOT EXISTS (SELECT 1 FROM SchemaMigrations WHERE Name='006_stock_notifications.sql' AND Checksum='CD550909AAD4529D0BDB6B31ED6F17F4212BCF7B27A069BC776FCE19478775E0') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Migration 006 checksum mismatch';
    END IF;
  ELSE
    IF (SELECT COUNT(*) FROM SchemaMigrations WHERE (Name='001_business.sql' AND Checksum='472F8E9842D3E2148671B8029ACD940EF5B558D10E10723DA423D925E441D92F') OR (Name='002_ledger_snapshots.sql' AND Checksum='4A5548B571A414895BDA608BDA5876468D3363A5A9275763768E027D31F83379') OR (Name='003_submission_attempts.sql' AND Checksum='35EE2C5D21D9B3EA5B5AE67ECDC27445A25B99609D14FA8A330548583F9828FF') OR (Name='004_user_role_preference.sql' AND Checksum='D70A7E7C65D27B1E6EC35FCBDF3FAD424436CEF6395086AACC91C6041A90E439') OR (Name='005_backoffice_permissions_audit.sql' AND Checksum='89D246EEA5157DDF79B5FF9931B0E070C04BEA44156C290C3FF1381FF95316D0')) <> 5 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Apply unchanged migrations 001-005 before this upgrade';
    ELSEIF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('StockNotifications','StockNotificationReads','WechatNotificationPreferences','WechatNotificationGrants','WechatNotificationDeliveries')) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Partial upgrade detected; inspect tables before proceeding';
    ELSE
-- 库存动态、个人阅读状态及一次性微信订阅授权；不改动已有业务数据。
CREATE TABLE StockNotifications (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, DocumentId BIGINT NOT NULL, Action VARCHAR(16) NOT NULL,
 Payload JSON NOT NULL, CreatedAt DATETIME(6) NOT NULL,
 UNIQUE KEY NotificationDocumentAction(DocumentId,Action),
 FOREIGN KEY(DocumentId) REFERENCES Documents(Id)
) ENGINE=InnoDB;
CREATE TABLE StockNotificationReads (
 UserId BIGINT NOT NULL, NotificationId BIGINT NOT NULL, ReadAt DATETIME(6) NOT NULL,
 PRIMARY KEY(UserId,NotificationId), FOREIGN KEY(UserId) REFERENCES Users(Id),
 FOREIGN KEY(NotificationId) REFERENCES StockNotifications(Id)
) ENGINE=InnoDB;
CREATE TABLE WechatNotificationPreferences (
 UserId BIGINT PRIMARY KEY, Paused BOOLEAN NOT NULL DEFAULT FALSE,
 FOREIGN KEY(UserId) REFERENCES Users(Id)
) ENGINE=InnoDB;
CREATE TABLE WechatNotificationGrants (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, UserId BIGINT NOT NULL, RequestKey VARCHAR(100) NOT NULL,
 AppId VARCHAR(80) NOT NULL, OpenId VARCHAR(128) NOT NULL, TemplateId VARCHAR(128) NOT NULL,
 Decision VARCHAR(16) NOT NULL, State VARCHAR(16) NOT NULL, CreatedAt DATETIME(6) NOT NULL,
 UNIQUE KEY SubscriptionRequest(UserId,RequestKey), INDEX AvailableGrant(UserId,State,Id),
 FOREIGN KEY(UserId) REFERENCES Users(Id)
) ENGINE=InnoDB;
CREATE TABLE WechatNotificationDeliveries (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, NotificationId BIGINT NOT NULL, UserId BIGINT NOT NULL,
 GrantId BIGINT NOT NULL UNIQUE, TemplateId VARCHAR(128) NOT NULL, Fields JSON NOT NULL,
 MiniprogramState VARCHAR(16) NOT NULL, State VARCHAR(16) NOT NULL DEFAULT 'PENDING',
 Attempts INT NOT NULL DEFAULT 0, ErrorCode INT NULL, LeaseToken CHAR(64) NULL,
 LeaseUntil DATETIME(6) NULL, NextAttemptAt DATETIME(6) NOT NULL,
 CreatedAt DATETIME(6) NOT NULL, FinishedAt DATETIME(6) NULL,
 UNIQUE KEY NotificationRecipient(NotificationId,UserId), INDEX DeliveryQueue(State,NextAttemptAt),
 FOREIGN KEY(NotificationId) REFERENCES StockNotifications(Id), FOREIGN KEY(UserId) REFERENCES Users(Id),
 FOREIGN KEY(GrantId) REFERENCES WechatNotificationGrants(Id)
) ENGINE=InnoDB;

      INSERT INTO SchemaMigrations VALUES ('006_stock_notifications.sql','CD550909AAD4529D0BDB6B31ED6F17F4212BCF7B27A069BC776FCE19478775E0',UTC_TIMESTAMP(6));
    END IF;
  END IF;
END$$
CALL `_codex_upgrade_notifications_006`()$$
DROP PROCEDURE `_codex_upgrade_notifications_006`$$
DELIMITER ;
SELECT Name,AppliedAt FROM SchemaMigrations ORDER BY Name;
SELECT COUNT(*) AS NotificationCount FROM StockNotifications;
