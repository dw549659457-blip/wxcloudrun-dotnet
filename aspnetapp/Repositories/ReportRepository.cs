using aspnetapp.Domain;
using aspnetapp.Configuration;
using aspnetapp.Infrastructure;

namespace aspnetapp.Repositories;

public sealed class ReportRepository(Database database, AppSettings? settings = null)
{
    public static readonly string[] Names = ["packaging-ledger", "vegetable-inbound", "vegetable-outbound", "external-packaging", "monthly-loss", "vegetable-differences", "inventory-ledger"];
    private static string Sql(string name) => name switch
    {
        "packaging-ledger" => "SELECT l.Id,d.Number,d.BusinessDate,l.ItemName AS Name,l.Unit,l.Specification,b.GrowerName,l.Domain,l.Event,l.Delta AS Quantity FROM InventoryLedger l JOIN Documents d ON d.Id=l.DocumentId JOIN Archives a ON a.Id=l.ItemId LEFT JOIN WorkBatches b ON b.Id=l.BatchId WHERE l.Domain IN ('WAREHOUSE_PACKAGING','EXTERNAL_PACKAGING') AND d.Status='POSTED' AND l.ReversalOf IS NULL",
        "vegetable-inbound" => "SELECT l.Id,d.Number,d.BusinessDate,l.ItemName AS Name,l.Unit,d.Kind,l.Event AS Source,l.Delta AS Quantity,b.GrowerName FROM InventoryLedger l JOIN Documents d ON d.Id=l.DocumentId JOIN Archives a ON a.Id=l.ItemId LEFT JOIN WorkBatches b ON b.Id=l.BatchId WHERE l.Domain='VEGETABLE' AND l.Delta>0 AND d.Status='POSTED' AND l.ReversalOf IS NULL",
        "vegetable-outbound" => "SELECT l.Id,d.Number,d.BusinessDate,i.ItemName AS Name,i.Unit,d.CustomerName,JSON_UNQUOTE(JSON_EXTRACT(d.Payload,'$.mode')) AS Mode,i.Quantity AS ActualQuantity,CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(d.Payload,'$.mode'))='DIRECT' THEN -i.Quantity ELSE i.Quantity END AS DisplayQuantity,JSON_UNQUOTE(JSON_EXTRACT(d.Payload,'$.remark')) AS Remark FROM DocumentItems i JOIN Documents d ON d.Id=i.DocumentId JOIN InventoryLedger l ON l.DocumentId=d.Id AND l.ItemId=i.ItemId WHERE d.Kind='OUTBOUND' AND d.Status='POSTED' AND l.ReversalOf IS NULL",
        "external-packaging" => "SELECT p.BatchId AS Id,d.Number,d.BusinessDate,b.GrowerName,u.Name AS DriverName,a.Name,a.Unit,p.Dispatched,p.Consumed,p.Recovered,p.Lost,p.Outstanding,GREATEST(DATEDIFF(@today,d.BusinessDate),0) AS DaysOutside FROM BatchPackagingBalances p JOIN WorkBatches b ON b.Id=p.BatchId JOIN Documents d ON d.Id=b.DispatchId JOIN Archives a ON a.Id=p.ItemId JOIN Users u ON u.Id=b.DriverId LEFT JOIN InventoryLedger l ON l.Id=NULL WHERE b.Status='OPEN' AND d.Status='POSTED'",
        "monthly-loss" => "SELECT MIN(p.ItemId) AS Id,DATE_FORMAT(d.BusinessDate,'%Y-%m') AS Month,a.Name,a.Unit,SUM(p.Lost) AS Lost,SUM(p.Dispatched) AS Dispatched,CASE WHEN SUM(p.Dispatched)=0 THEN NULL ELSE SUM(p.Lost)/SUM(p.Dispatched) END AS LossRate FROM BatchPackagingBalances p JOIN WorkBatches b ON b.Id=p.BatchId JOIN Documents d ON d.Id=b.FinalRecoveryId JOIN Archives a ON a.Id=p.ItemId LEFT JOIN InventoryLedger l ON l.Id=NULL WHERE b.Status='CLOSED' AND d.Status='POSTED'",
        "vegetable-differences" => "SELECT v.BatchId AS Id,d.Number,d.BusinessDate,b.GrowerName,a.Name,a.Unit,v.Output,v.Received,v.Output-v.Received AS Difference FROM BatchVegetableBalances v JOIN WorkBatches b ON b.Id=v.BatchId JOIN Documents d ON d.Id=b.DispatchId JOIN Archives a ON a.Id=v.ItemId LEFT JOIN InventoryLedger l ON l.Id=NULL WHERE d.Status='POSTED'",
        "inventory-ledger" => "SELECT l.Id,d.Number,d.BusinessDate,d.Status,l.ItemName AS Name,l.Unit,b.GrowerName,l.Domain,l.Event,l.Delta AS Quantity,l.ReversalOf,l.CreatedAt FROM InventoryLedger l JOIN Documents d ON d.Id=l.DocumentId JOIN Archives a ON a.Id=l.ItemId LEFT JOIN WorkBatches b ON b.Id=l.BatchId WHERE 1=1",
        _ => throw new BusinessException(404, "NOT_FOUND", "未知报表")
    };
    public async Task<List<Row>> Rows(Actor actor, string name, PageQuery query, bool export = false)
    {
        actor.RequirePermission(export ? "reports.export" : "reports.read"); QueryRepository.Validate(query);
        var sql = Sql(name);
        var itemAlias = name is "external-packaging" or "monthly-loss" ? "p.ItemId" : name == "vegetable-differences" ? "v.ItemId" : "l.ItemId";
        sql += " AND (@from IS NULL OR d.BusinessDate>=@from) AND (@to IS NULL OR d.BusinessDate<=@to) AND (@item IS NULL OR " + itemAlias + "=@item) AND (@grower IS NULL OR b.GrowerId=@grower)";
        // 出库报表没有棚户/司机关联，不接受这些筛选，避免悄悄忽略用户范围。
        if (name == "vegetable-outbound")
        {
            if (query.GrowerId is not null || query.DriverId is not null)
            {
                throw BusinessException.Invalid("出库报表不支持棚户/司机筛选");
            }

            sql = sql.Replace(" AND (@grower IS NULL OR b.GrowerId=@grower)", "");
        }
        else
        {
            sql += " AND (@driver IS NULL OR b.DriverId=@driver)";
        }

        sql += " AND (@source IS NULL OR l.Event=@source)";
        if (name is "external-packaging" or "monthly-loss" or "vegetable-differences")
        {
            if (query.Source is not null)
            {
                throw BusinessException.Invalid("此报表不支持流水来源筛选");
            }
        }
        if (name == "monthly-loss")
        {
            sql += " GROUP BY DATE_FORMAT(d.BusinessDate,'%Y-%m'),p.ItemId,a.Name,a.Unit";
        }

        sql += " ORDER BY Id " + (query.Sort == "asc" ? "ASC" : "DESC") + " LIMIT @limit OFFSET @offset";
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, sql, ("from", query.From?.ToString("yyyy-MM-dd")), ("to", query.To?.ToString("yyyy-MM-dd")), ("item", query.ItemId), ("grower", query.GrowerId), ("driver", query.DriverId), ("source", query.Source), ("today", TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(settings?.TimeZone ?? "Asia/Shanghai")).ToString("yyyy-MM-dd")), ("limit", export ? 50001 : query.PageSize), ("offset", export ? 0 : (query.Page - 1) * query.PageSize));
        if (export && rows.Count > 50000)
        {
            throw new BusinessException(422, "EXPORT_LIMIT", "导出超过 50,000 行，请缩小日期或品类范围");
        }

        return rows;
    }
    public async Task<List<Dictionary<string, object?>>> Reconcile()
    {
        await using var connection = await database.Open();
        // 同一一致性快照读取余额和流水，避免把正在提交的合法事务看成不一致。
        await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var stock = await Database.Query(connection, transaction, "SELECT b.ItemId,b.Quantity,COALESCE(SUM(l.Delta),0) AS LedgerQuantity FROM InventoryBalances b LEFT JOIN InventoryLedger l ON l.ItemId=b.ItemId AND l.Domain IN ('VEGETABLE','WAREHOUSE_PACKAGING') GROUP BY b.ItemId,b.Quantity HAVING b.Quantity<>LedgerQuantity OR b.Quantity<0");
        var batches = await Database.Query(connection, transaction, "SELECT p.BatchId,p.ItemId,p.Dispatched,p.Consumed,p.Recovered,p.Lost,p.Outstanding,COALESCE(SUM(l.Delta),0) AS LedgerQuantity FROM BatchPackagingBalances p LEFT JOIN InventoryLedger l ON l.BatchId=p.BatchId AND l.ItemId=p.ItemId AND l.Domain='EXTERNAL_PACKAGING' GROUP BY p.BatchId,p.ItemId,p.Dispatched,p.Consumed,p.Recovered,p.Lost,p.Outstanding HAVING p.Dispatched<>p.Consumed+p.Recovered+p.Lost+p.Outstanding OR p.Outstanding<>LedgerQuantity OR LEAST(p.Consumed,p.Recovered,p.Lost,p.Outstanding)<0");
        var vegetables = await Database.Query(connection, transaction, "SELECT v.BatchId,v.ItemId,v.Output,v.Received,COALESCE(SUM(CASE WHEN d.Status='POSTED' AND i.LineKind='OUTPUT' THEN i.Quantity ELSE 0 END),0) AS LedgerOutput,COALESCE(SUM(CASE WHEN d.Status='POSTED' AND i.LineKind='RECEIVED' THEN i.Quantity ELSE 0 END),0) AS LedgerReceived FROM BatchVegetableBalances v LEFT JOIN DocumentItems i ON i.BatchId=v.BatchId AND i.ItemId=v.ItemId LEFT JOIN Documents d ON d.Id=i.DocumentId GROUP BY v.BatchId,v.ItemId,v.Output,v.Received HAVING v.Output<>LedgerOutput OR v.Received<>LedgerReceived OR LEAST(v.Output,v.Received)<0");
        await transaction.CommitAsync();
        return stock.Concat(batches).Concat(vegetables).Select(row => row.Output()).ToList();
    }
}
