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
