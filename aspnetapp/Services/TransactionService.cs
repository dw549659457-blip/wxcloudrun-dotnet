using System.Security.Cryptography;
using System.Text;
using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using MySqlConnector;

namespace aspnetapp.Services;

public sealed class TransactionService(Database database)
{
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public async Task<T> Run<T>(Func<MySqlConnection, MySqlTransaction, Task<T>> operation)
    {
        await using var connection = await database.Open();
        await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted);
        try
        {
            // 单仓库先锁持久闸门，再按品类 ID 锁余额；多个副本共享同一锁，无内存锁依赖。
            await Database.Query(connection, transaction, "SELECT Id FROM StockTransactionGate WHERE Id=1 FOR UPDATE");
            var result = await operation(connection, transaction);
            await transaction.CommitAsync();
            return result;
        }
        catch
        {
            try { await transaction.RollbackAsync(); }
            catch (MySqlException)
            {
                throw new BusinessException(503, "SUBMISSION_NOT_CONFIRMED", "提交结果暂未确认，请使用原提交标识查询");
            }
            throw;
        }
    }
    public async Task<T> Idempotent<T>(Actor actor, string operation, string key, object payload, Func<MySqlConnection, MySqlTransaction, Task<T>> action)
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length > 100)
        {
            throw BusinessException.Invalid("提交需要有效的 Idempotency-Key，最多 100 字符");
        }

        var hash = Hash(JsonSettings.Serialize(payload));
        await using (var statusConnection = await database.Open())
        {
            await Database.Execute(statusConnection, null,
                "INSERT INTO SubmissionAttempts VALUES(@user,@operation,@key,'PENDING',NULL,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE State='PENDING',FailureCode=NULL,UpdatedAt=UTC_TIMESTAMP(6)",
                [("user", actor.Id), ("operation", operation), ("key", key)]);
        }
        try
        {
            return await Run(async (connection, transaction) =>
        {
            await Database.Execute(connection, transaction,
                "INSERT IGNORE INTO IdempotencyRecords(UserId,Operation,IdempotencyKey,PayloadHash,CreatedAt) VALUES(@user,@operation,@key,@hash,UTC_TIMESTAMP(6))",
                [("user", actor.Id), ("operation", operation), ("key", key), ("hash", hash)]);
            var rows = await Database.Query(connection, transaction,
                "SELECT PayloadHash,ResultJson FROM IdempotencyRecords WHERE UserId=@user AND Operation=@operation AND IdempotencyKey=@key FOR UPDATE",
                ("user", actor.Id), ("operation", operation), ("key", key));
            if (rows[0].Text("PayloadHash") != hash)
            {
                throw BusinessException.Conflict("IDEMPOTENCY_CONFLICT", "同一个提交标识不能用于不同内容");
            }

            if (!rows[0].IsNull("ResultJson"))
            {
                return JsonSettings.Deserialize<T>(rows[0].Text("ResultJson"));
            }

            var result = await action(connection, transaction);
            await Database.Execute(connection, transaction,
                "UPDATE IdempotencyRecords SET ResultJson=@result WHERE UserId=@user AND Operation=@operation AND IdempotencyKey=@key",
                [("result", JsonSettings.Serialize(result)), ("user", actor.Id), ("operation", operation), ("key", key)]);
            // 失败事务会回滚幂等行；提交与结果同一事务，提交响应丢失也能查询。
            await Database.Execute(connection, transaction,
                "UPDATE SubmissionAttempts SET State='SUCCEEDED',UpdatedAt=UTC_TIMESTAMP(6) WHERE UserId=@user AND Operation=@operation AND IdempotencyKey=@key",
                [("user", actor.Id), ("operation", operation), ("key", key)]);
            return result;
        });
        }
        catch (BusinessException error) when (error.Status < 500)
        {
            // 只有事务已明确回滚的业务失败才记录 FAILED，连接中断等未知结果保持 PENDING。
            await using var statusConnection = await database.Open();
            await Database.Execute(statusConnection, null,
                "UPDATE SubmissionAttempts SET State='FAILED',FailureCode=@code,UpdatedAt=UTC_TIMESTAMP(6) WHERE UserId=@user AND Operation=@operation AND IdempotencyKey=@key",
                [("code", error.Code), ("user", actor.Id), ("operation", operation), ("key", key)]);
            throw;
        }
    }
}
