-- 微信云托管业务数据库首次初始化；默认库名 vegetable_prod。
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

-- 001_business.sql
-- MySQL 5.7/8.0 通用结构；显式迁移，不触碰原 aspnet_demo 库。
CREATE TABLE Users (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, Username VARCHAR(80) NOT NULL UNIQUE,
 Name VARCHAR(80) NOT NULL, Phone VARCHAR(32) NULL UNIQUE, PasswordHash VARCHAR(300) NULL,
 Enabled BOOLEAN NOT NULL DEFAULT TRUE, AppId VARCHAR(80) NULL, OpenId VARCHAR(128) NULL,
 CreatedAt DATETIME(6) NOT NULL, UNIQUE KEY UserWechatIdentity(AppId,OpenId)
) ENGINE=InnoDB;
CREATE TABLE UserRoles (UserId BIGINT NOT NULL, Role VARCHAR(16) NOT NULL, PRIMARY KEY(UserId,Role), FOREIGN KEY(UserId) REFERENCES Users(Id)) ENGINE=InnoDB;
CREATE TABLE Sessions (
 TokenHash CHAR(64) PRIMARY KEY, UserId BIGINT NOT NULL, SessionType VARCHAR(20) NOT NULL,
 CsrfHash CHAR(64) NULL, SelectedRole VARCHAR(16) NULL, ExpiresAt DATETIME(6) NOT NULL, RevokedAt DATETIME(6) NULL,
 FOREIGN KEY(UserId) REFERENCES Users(Id), INDEX SessionExpiry(ExpiresAt)
) ENGINE=InnoDB;
CREATE TABLE LoginAttempts (AttemptKey CHAR(64) PRIMARY KEY, Attempts INT NOT NULL, WindowStart DATETIME(6) NOT NULL) ENGINE=InnoDB;
CREATE TABLE Bindings (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, TokenHash CHAR(64) NOT NULL UNIQUE, AppId VARCHAR(80) NOT NULL,
 OpenId VARCHAR(128) NOT NULL, CandidateUserId BIGINT NULL, Status VARCHAR(20) NOT NULL,
 ExpiresAt DATETIME(6) NOT NULL, Reason VARCHAR(500) NOT NULL DEFAULT '', ApprovedBy BIGINT NULL,
 CreatedAt DATETIME(6) NOT NULL, FOREIGN KEY(CandidateUserId) REFERENCES Users(Id), FOREIGN KEY(ApprovedBy) REFERENCES Users(Id)
) ENGINE=InnoDB;
CREATE TABLE Archives (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, Kind VARCHAR(20) NOT NULL, Name VARCHAR(100) NOT NULL,
 Unit VARCHAR(16) NOT NULL DEFAULT '', Specification VARCHAR(200) NOT NULL DEFAULT '',
 Contact VARCHAR(80) NOT NULL DEFAULT '', Phone VARCHAR(32) NOT NULL DEFAULT '', Enabled BOOLEAN NOT NULL DEFAULT TRUE,
 INDEX ArchiveKind(Kind,Enabled)
) ENGINE=InnoDB;
CREATE TABLE InventoryBalances (
 ItemId BIGINT PRIMARY KEY, Quantity DECIMAL(18,3) NOT NULL DEFAULT 0, Version INT NOT NULL DEFAULT 1,
 FOREIGN KEY(ItemId) REFERENCES Archives(Id)
) ENGINE=InnoDB;
-- 单据共用头表，种类及运行时 DTO 校验保证对应业务关系；明细和账本独立关系表。
CREATE TABLE Documents (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, Number VARCHAR(50) NOT NULL UNIQUE, Kind VARCHAR(20) NOT NULL,
 CreatorId BIGINT NOT NULL, BusinessDate DATE NOT NULL, Status VARCHAR(16) NOT NULL, Version INT NOT NULL DEFAULT 1,
 Payload JSON NOT NULL, CustomerId BIGINT NULL, CustomerName VARCHAR(100) NULL, CreatorName VARCHAR(80) NOT NULL DEFAULT '', ReplacesId BIGINT NULL, CreatedAt DATETIME(6) NOT NULL, PostedAt DATETIME(6) NULL,
 FOREIGN KEY(CustomerId) REFERENCES Archives(Id), FOREIGN KEY(CreatorId) REFERENCES Users(Id), FOREIGN KEY(ReplacesId) REFERENCES Documents(Id),
 INDEX DocumentOwner(Kind,CreatorId,BusinessDate), INDEX DocumentDate(Status,BusinessDate)
) ENGINE=InnoDB;
CREATE TABLE WorkBatches (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, DispatchId BIGINT NOT NULL, GrowerId BIGINT NOT NULL, DriverId BIGINT NOT NULL,
 GrowerName VARCHAR(100) NOT NULL, Status VARCHAR(16) NOT NULL DEFAULT 'OPEN', FinalRecoveryId BIGINT NULL,
 Version INT NOT NULL DEFAULT 1, FOREIGN KEY(DispatchId) REFERENCES Documents(Id), FOREIGN KEY(GrowerId) REFERENCES Archives(Id),
 FOREIGN KEY(DriverId) REFERENCES Users(Id), FOREIGN KEY(FinalRecoveryId) REFERENCES Documents(Id), UNIQUE KEY DispatchGrower(DispatchId,GrowerId)
) ENGINE=InnoDB;
CREATE TABLE DocumentItems (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, DocumentId BIGINT NOT NULL, LineKind VARCHAR(20) NOT NULL,
 ItemId BIGINT NOT NULL, GrowerId BIGINT NULL, BatchId BIGINT NULL, Quantity DECIMAL(18,3) NOT NULL,
 Direction VARCHAR(4) NOT NULL, ItemName VARCHAR(100) NOT NULL, Unit VARCHAR(16) NOT NULL, Specification VARCHAR(200) NOT NULL,
 FOREIGN KEY(DocumentId) REFERENCES Documents(Id), FOREIGN KEY(ItemId) REFERENCES Archives(Id),
 FOREIGN KEY(GrowerId) REFERENCES Archives(Id), FOREIGN KEY(BatchId) REFERENCES WorkBatches(Id), INDEX ItemDocument(ItemId,DocumentId)
) ENGINE=InnoDB;
CREATE TABLE BatchPackagingBalances (
 BatchId BIGINT NOT NULL, ItemId BIGINT NOT NULL, Dispatched DECIMAL(18,3) NOT NULL, Consumed DECIMAL(18,3) NOT NULL DEFAULT 0,
 Recovered DECIMAL(18,3) NOT NULL DEFAULT 0, Lost DECIMAL(18,3) NOT NULL DEFAULT 0, Outstanding DECIMAL(18,3) NOT NULL,
 Version INT NOT NULL DEFAULT 1, PRIMARY KEY(BatchId,ItemId), FOREIGN KEY(BatchId) REFERENCES WorkBatches(Id), FOREIGN KEY(ItemId) REFERENCES Archives(Id)
) ENGINE=InnoDB;
CREATE TABLE BatchVegetableBalances (
 BatchId BIGINT NOT NULL, ItemId BIGINT NOT NULL, Output DECIMAL(18,3) NOT NULL DEFAULT 0, Received DECIMAL(18,3) NOT NULL DEFAULT 0,
 PRIMARY KEY(BatchId,ItemId), FOREIGN KEY(BatchId) REFERENCES WorkBatches(Id), FOREIGN KEY(ItemId) REFERENCES Archives(Id)
) ENGINE=InnoDB;
CREATE TABLE InventoryLedger (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, Domain VARCHAR(30) NOT NULL, ItemId BIGINT NOT NULL, BatchId BIGINT NULL,
 Delta DECIMAL(18,3) NOT NULL, Event VARCHAR(30) NOT NULL, DocumentId BIGINT NOT NULL, ActorId BIGINT NOT NULL,
 ReversalOf BIGINT NULL UNIQUE, CreatedAt DATETIME(6) NOT NULL,
 FOREIGN KEY(ItemId) REFERENCES Archives(Id), FOREIGN KEY(BatchId) REFERENCES WorkBatches(Id), FOREIGN KEY(DocumentId) REFERENCES Documents(Id),
 FOREIGN KEY(ActorId) REFERENCES Users(Id), FOREIGN KEY(ReversalOf) REFERENCES InventoryLedger(Id), INDEX LedgerItem(Domain,ItemId), INDEX LedgerSource(DocumentId)
) ENGINE=InnoDB;
CREATE TABLE DocumentDependencies (
 ParentId BIGINT NOT NULL, ChildId BIGINT NOT NULL, PRIMARY KEY(ParentId,ChildId),
 FOREIGN KEY(ParentId) REFERENCES Documents(Id), FOREIGN KEY(ChildId) REFERENCES Documents(Id)
) ENGINE=InnoDB;
CREATE TABLE AuditLogs (
 Id BIGINT PRIMARY KEY AUTO_INCREMENT, ActorId BIGINT NOT NULL, Action VARCHAR(40) NOT NULL,
 EntityType VARCHAR(30) NOT NULL, EntityId BIGINT NOT NULL, BeforeJson JSON NULL, AfterJson JSON NULL,
 Reason VARCHAR(500) NOT NULL, RequestId VARCHAR(80) NOT NULL, CreatedAt DATETIME(6) NOT NULL,
 FOREIGN KEY(ActorId) REFERENCES Users(Id), INDEX AuditEntity(EntityType,EntityId)
) ENGINE=InnoDB;
CREATE TABLE IdempotencyRecords (
 UserId BIGINT NOT NULL, Operation VARCHAR(100) NOT NULL, IdempotencyKey VARCHAR(100) NOT NULL,
 PayloadHash CHAR(64) NOT NULL, ResultJson JSON NULL, CreatedAt DATETIME(6) NOT NULL,
 PRIMARY KEY(UserId,Operation,IdempotencyKey), FOREIGN KEY(UserId) REFERENCES Users(Id)
) ENGINE=InnoDB;
-- 单仓库内写入使用一个持久行锁：跨副本一致，无进程内锁；防止跨业务/修正锁次序产生死锁。
-- 此系统首先保证库存正确，每笔写事务很短，不在锁内调用微信/网络或生成 Excel。
CREATE TABLE StockTransactionGate (Id INT PRIMARY KEY);
INSERT INTO StockTransactionGate VALUES (1);

INSERT INTO SchemaMigrations (Name,Checksum,AppliedAt) VALUES ('001_business.sql','472F8E9842D3E2148671B8029ACD940EF5B558D10E10723DA423D925E441D92F',UTC_TIMESTAMP(6));

-- 002_ledger_snapshots.sql
-- 流水保留历史档案快照；档案改名不会重写历史报表名称。
ALTER TABLE InventoryLedger ADD COLUMN ItemName VARCHAR(100) NOT NULL DEFAULT '', ADD COLUMN Unit VARCHAR(16) NOT NULL DEFAULT '', ADD COLUMN Specification VARCHAR(200) NOT NULL DEFAULT '';
UPDATE InventoryLedger l JOIN Archives a ON a.Id=l.ItemId SET l.ItemName=a.Name,l.Unit=a.Unit,l.Specification=a.Specification;

INSERT INTO SchemaMigrations (Name,Checksum,AppliedAt) VALUES ('002_ledger_snapshots.sql','4A5548B571A414895BDA608BDA5876468D3363A5A9275763768E027D31F83379',UTC_TIMESTAMP(6));

-- 003_submission_attempts.sql
-- 尝试状态独立于成功幂等记录；失败不永久占用幂等键，未知结果保留待确认。
CREATE TABLE SubmissionAttempts (
 UserId BIGINT NOT NULL, Operation VARCHAR(100) NOT NULL, IdempotencyKey VARCHAR(100) NOT NULL,
 State VARCHAR(20) NOT NULL, FailureCode VARCHAR(80) NULL, UpdatedAt DATETIME(6) NOT NULL,
 PRIMARY KEY(UserId,Operation,IdempotencyKey), FOREIGN KEY(UserId) REFERENCES Users(Id)
) ENGINE=InnoDB;

INSERT INTO SchemaMigrations (Name,Checksum,AppliedAt) VALUES ('003_submission_attempts.sql','35EE2C5D21D9B3EA5B5AE67ECDC27445A25B99609D14FA8A330548583F9828FF',UTC_TIMESTAMP(6));

-- 004_user_role_preference.sql
-- 已绑定员工重新登录仍记住上次身份；实际权限始终来自 UserRoles。
ALTER TABLE Users ADD COLUMN PreferredRole VARCHAR(16) NULL;

INSERT INTO SchemaMigrations (Name,Checksum,AppliedAt) VALUES ('004_user_role_preference.sql','D70A7E7C65D27B1E6EC35FCBDF3FAD424436CEF6395086AACC91C6041A90E439',UTC_TIMESTAMP(6));

-- 005_backoffice_permissions_audit.sql
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

INSERT INTO SchemaMigrations (Name,Checksum,AppliedAt) VALUES ('005_backoffice_permissions_audit.sql','89D246EEA5157DDF79B5FF9931B0E070C04BEA44156C290C3FF1381FF95316D0',UTC_TIMESTAMP(6));

-- 006_stock_notifications.sql
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

INSERT INTO SchemaMigrations (Name,Checksum,AppliedAt) VALUES ('006_stock_notifications.sql','CD550909AAD4529D0BDB6B31ED6F17F4212BCF7B27A069BC776FCE19478775E0',UTC_TIMESTAMP(6));

  END IF;
END$$
CALL `_codex_initialize_vegetable_v1`()$$
DROP PROCEDURE `_codex_initialize_vegetable_v1`$$
DELIMITER ;

SELECT Name, Checksum, AppliedAt FROM SchemaMigrations ORDER BY Name;
-- 业务管理员使用应用 APP_COMMAND=init-admin 初始化，密码由 PBKDF2 加密。
-- 设置 INITIAL_ADMIN_USERNAME 与 INITIAL_ADMIN_PASSWORD（12—128 字符）后运行一次，
-- 然后移除 APP_COMMAND 和 INITIAL_ADMIN_*，启动正常 API 服务。
