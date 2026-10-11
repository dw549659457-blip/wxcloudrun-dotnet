-- 已有 vegetable_prod 业务库升级：会计权限与后台操作审计。
-- 保留原 admin、其他账号、库存、单据及流水；不会创建会计账号或改密码。
-- 必须先完成 001-004；执行完此文件后再发布含 005 的新服务版本。
-- 如使用其他业务库，仅修改 USE；服务 MYSQL_DATABASE 必须匹配。
-- 支持重复执行：已登记且校验相同则跳过，不重置已配置的会计权限。
-- 执行器须支持 DELIMITER；MySQL DDL 不具备整份事务回滚。
-- 自动生成：python3 scripts/generate-backoffice-upgrade-sql.py
SET NAMES utf8mb4;
USE `vegetable_prod`;
DELIMITER $$
DROP PROCEDURE IF EXISTS `_codex_upgrade_backoffice_005`$$
CREATE PROCEDURE `_codex_upgrade_backoffice_005`()
BEGIN
  IF EXISTS (SELECT 1 FROM SchemaMigrations WHERE Name='005_backoffice_permissions_audit.sql') THEN
    IF NOT EXISTS (SELECT 1 FROM SchemaMigrations WHERE Name='005_backoffice_permissions_audit.sql' AND Checksum='89D246EEA5157DDF79B5FF9931B0E070C04BEA44156C290C3FF1381FF95316D0') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Migration 005 checksum mismatch';
    END IF;
  ELSE
    IF (SELECT COUNT(*) FROM SchemaMigrations WHERE (Name='001_business.sql' AND Checksum='472F8E9842D3E2148671B8029ACD940EF5B558D10E10723DA423D925E441D92F') OR (Name='002_ledger_snapshots.sql' AND Checksum='4A5548B571A414895BDA608BDA5876468D3363A5A9275763768E027D31F83379') OR (Name='003_submission_attempts.sql' AND Checksum='35EE2C5D21D9B3EA5B5AE67ECDC27445A25B99609D14FA8A330548583F9828FF') OR (Name='004_user_role_preference.sql' AND Checksum='D70A7E7C65D27B1E6EC35FCBDF3FAD424436CEF6395086AACC91C6041A90E439')) <> 4 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Apply unchanged migrations 001-004 before this upgrade';
    ELSEIF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('BackOfficeRolePolicies','BackOfficeRolePermissions','BackOfficeOperationLogs')) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Partial upgrade detected; inspect tables before proceeding';
    ELSE
-- 只新增权限配置与请求审计，不改动既有账号、库存或业务流水。
CREATE TABLE BackOfficeRolePolicies (
 Role VARCHAR(16) PRIMARY KEY, Version INT NOT NULL DEFAULT 1,
 UpdatedAt DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE BackOfficeRolePermissions (
 Role VARCHAR(16) NOT NULL, PermissionKey VARCHAR(80) NOT NULL,
 PRIMARY KEY(Role,PermissionKey),
 FOREIGN KEY(Role) REFERENCES BackOfficeRolePolicies(Role)
) ENGINE=InnoDB;
INSERT INTO BackOfficeRolePolicies VALUES ('ACCOUNTANT',1,UTC_TIMESTAMP(6));
INSERT INTO BackOfficeRolePermissions (Role,PermissionKey) VALUES
 ('ACCOUNTANT','archives.read'),('ACCOUNTANT','archives.export'),
 ('ACCOUNTANT','users.read'),('ACCOUNTANT','users.export'),
 ('ACCOUNTANT','inventory.read'),('ACCOUNTANT','inventory.export'),
 ('ACCOUNTANT','batches.read'),('ACCOUNTANT','batches.export'),
 ('ACCOUNTANT','documents.read'),('ACCOUNTANT','documents.export'),
 ('ACCOUNTANT','reports.read'),('ACCOUNTANT','reports.export'),
 ('ACCOUNTANT','reconcile.read');
CREATE TABLE BackOfficeOperationLogs (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT,
 ActorId BIGINT NOT NULL, Username VARCHAR(80) NOT NULL,
 ActorName VARCHAR(80) NOT NULL, ActorRoles VARCHAR(120) NOT NULL,
 Action VARCHAR(20) NOT NULL, Module VARCHAR(80) NOT NULL,
 Method VARCHAR(8) NOT NULL, Path VARCHAR(240) NOT NULL,
 QueryJson TEXT NOT NULL, RequestId VARCHAR(64) NOT NULL,
 StatusCode INT NULL, State VARCHAR(20) NOT NULL DEFAULT 'STARTED',
 ErrorCode VARCHAR(80) NULL, DurationMs BIGINT NULL,
 CreatedAt DATETIME(6) NOT NULL, CompletedAt DATETIME(6) NULL,
 FOREIGN KEY(ActorId) REFERENCES Users(Id),
 INDEX OperationActorTime(ActorId,CreatedAt),
 INDEX OperationTime(CreatedAt), INDEX OperationRequest(RequestId)
) ENGINE=InnoDB;

      INSERT INTO SchemaMigrations VALUES ('005_backoffice_permissions_audit.sql','89D246EEA5157DDF79B5FF9931B0E070C04BEA44156C290C3FF1381FF95316D0',UTC_TIMESTAMP(6));
    END IF;
  END IF;
END$$
CALL `_codex_upgrade_backoffice_005`()$$
DROP PROCEDURE `_codex_upgrade_backoffice_005`$$
DELIMITER ;
SELECT Name,AppliedAt FROM SchemaMigrations ORDER BY Name;
SELECT Role,Version,UpdatedAt FROM BackOfficeRolePolicies;
