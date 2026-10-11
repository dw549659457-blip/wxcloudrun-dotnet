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
