using MySqlConnector;
using aspnetapp.Infrastructure;
using aspnetapp.Domain;

namespace aspnetapp.Repositories;

public sealed class InventoryRepository
{
    public async Task<Row> Archive(MySqlConnection connection, MySqlTransaction transaction, long id, string kind)
    {
        var rows = await Database.Query(connection, transaction, "SELECT * FROM Archives WHERE Id=@id AND Kind=@kind FOR UPDATE", ("id", id), ("kind", kind));
        if (rows.Count == 0 || !rows[0].Flag("Enabled"))
        {
            throw BusinessException.Invalid("档案不存在或已停用");
        }

        return rows[0];
    }
    public static void ValidateQuantity(decimal value, string unit)
    {
        if (value <= 0 || value > 999999999999999.999m || decimal.Round(value, 3) != value)
        {
            throw BusinessException.Invalid("数量必须大于零，最多 3 位小数且不超过数据库容量");
        }

        if (unit != "公斤" && decimal.Truncate(value) != value)
        {
            throw BusinessException.Invalid("包装和箱数量必须是正整数");
        }
    }
    public async Task ChangeWarehouse(MySqlConnection connection, MySqlTransaction transaction, long itemId, decimal delta, long documentId, long actorId, string domain, string eventName, long? batchId = null, long? reversalOf = null)
    {
        var rows = await Database.Query(connection, transaction, "SELECT Quantity FROM InventoryBalances WHERE ItemId=@item FOR UPDATE", ("item", itemId));
        if (rows.Count == 0)
        {
            throw BusinessException.Invalid("库存档案未初始化");
        }

        if (rows[0].Quantity("Quantity") + delta > 999999999999999.999m)
        {
            throw BusinessException.Invalid("库存超过数据库容量");
        }

        var changed = await Database.Execute(connection, transaction, "UPDATE InventoryBalances SET Quantity=Quantity+@delta,Version=Version+1 WHERE ItemId=@item AND Quantity+@delta>=0", [("delta", delta), ("item", itemId)]);
        if (changed != 1)
        {
            throw BusinessException.Conflict("INSUFFICIENT_STOCK", "库存不足，整单未入账", new { itemId, available = rows[0].Quantity("Quantity") });
        }

        if (delta < 0 && reversalOf is null)
        {
            // 没有 FIFO 分摊：保守记录既有入库来源依赖，冲销须按依赖逆序进行。
            await Database.Execute(connection, transaction,
                "INSERT IGNORE INTO DocumentDependencies SELECT DISTINCT l.DocumentId,@document FROM InventoryLedger l JOIN Documents d ON d.Id=l.DocumentId WHERE l.ItemId=@item AND l.Domain=@domain AND l.Delta>0 AND l.ReversalOf IS NULL AND d.Status='POSTED' AND l.DocumentId<>@document",
                [("document", documentId), ("item", itemId), ("domain", domain)]);
        }
        await Ledger(connection, transaction, domain, itemId, batchId, delta, eventName, documentId, actorId, reversalOf);
    }
    public Task<long> Ledger(MySqlConnection connection, MySqlTransaction transaction, string domain, long itemId, long? batchId, decimal delta, string eventName, long documentId, long actorId, long? reversalOf = null) => Database.Insert(connection, transaction,
        "INSERT INTO InventoryLedger(Domain,ItemId,BatchId,Delta,Event,DocumentId,ActorId,ReversalOf,ItemName,Unit,Specification,CreatedAt) VALUES(@domain,@item,@batch,@delta,@event,@document,@actor,@reverse,(SELECT Name FROM Archives WHERE Id=@item),(SELECT Unit FROM Archives WHERE Id=@item),(SELECT Specification FROM Archives WHERE Id=@item),UTC_TIMESTAMP(6))",
        ("domain", domain), ("item", itemId), ("batch", batchId), ("delta", delta), ("event", eventName), ("document", documentId), ("actor", actorId), ("reverse", reversalOf));
    public async Task<Row> Batch(MySqlConnection connection, MySqlTransaction transaction, long batchId, Actor actor, bool worker)
    {
        var rows = await Database.Query(connection, transaction, "SELECT b.*,d.Status AS DispatchStatus FROM WorkBatches b JOIN Documents d ON d.Id=b.DispatchId WHERE b.Id=@id FOR UPDATE", ("id", batchId));
        if (rows.Count == 0)
        {
            throw new BusinessException(404, "NOT_FOUND", "未找到作业批次");
        }

        var batch = rows[0];
        if (!worker && !actor.IsBackOffice && batch.Id("DriverId") != actor.Id)
        {
            throw new BusinessException(404, "NOT_FOUND", "未找到作业批次");
        }

        if (batch.Text("Status") != BatchStatuses.Open || batch.Text("DispatchStatus") != DocumentStatuses.Posted)
        {
            throw BusinessException.Conflict("BATCH_CLOSED", "这户已经收完，不能继续记账");
        }

        return batch;
    }
    public Task BatchDependencies(MySqlConnection connection, MySqlTransaction transaction, long batchId, long documentId) => Database.Execute(connection, transaction,
        "INSERT IGNORE INTO DocumentDependencies SELECT DISTINCT d.Id,@document FROM Documents d LEFT JOIN DocumentItems i ON i.DocumentId=d.Id JOIN WorkBatches b ON b.Id=@batch WHERE d.Status='POSTED' AND d.Id<>@document AND (d.Id=b.DispatchId OR i.BatchId=@batch)", [("document", documentId), ("batch", batchId)]);
}
