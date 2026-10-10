-- 尝试状态独立于成功幂等记录；失败不永久占用幂等键，未知结果保留待确认。
CREATE TABLE SubmissionAttempts (
 UserId BIGINT NOT NULL, Operation VARCHAR(100) NOT NULL, IdempotencyKey VARCHAR(100) NOT NULL,
 State VARCHAR(20) NOT NULL, FailureCode VARCHAR(80) NULL, UpdatedAt DATETIME(6) NOT NULL,
 PRIMARY KEY(UserId,Operation,IdempotencyKey), FOREIGN KEY(UserId) REFERENCES Users(Id)
) ENGINE=InnoDB;
