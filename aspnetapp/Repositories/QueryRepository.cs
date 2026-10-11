using aspnetapp.Domain;
using aspnetapp.Configuration;
using aspnetapp.Infrastructure;

namespace aspnetapp.Repositories;

/// <summary>固定 SQL 模板 + 参数；分页和筛选在数据库执行，权限同时作用于列表、详情、导出。</summary>
public sealed class QueryRepository(Database database, AppSettings settings)
{
    public static void Validate(PageQuery query)
    {
        if (query.Page < 1 || query.Page > 1000000 || query.PageSize is < 1 or > 100 || query.Sort is not ("asc" or "desc") || query.From > query.To || (query.Search?.Length ?? 0) > 100)
        {
            throw BusinessException.Invalid("分页、日期或排序参数无效");
        }
    }
    public async Task<object> Archives(Actor actor, string kind, PageQuery query)
    {
        Validate(query);
        if (!actor.IsBackOffice)
        {
            var allowed = kind switch { ArchiveKinds.Packaging => new[] { Roles.Driver, Roles.Worker }, ArchiveKinds.Grower => new[] { Roles.Driver, Roles.Worker }, InventoryDomains.Vegetable => new[] { Roles.Driver, Roles.Worker, Roles.Outbound }, ArchiveKinds.Customer => new[] { Roles.Outbound }, _ => Array.Empty<string>() };
            actor.Require(allowed);
        }
        if (actor.IsBackOffice) actor.RequirePermission("archives.read");
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT Id,Kind,Name,Unit,Specification,Enabled" + (actor.IsBackOffice ? ",Contact,Phone" : "") + " FROM Archives WHERE Kind=@kind AND (@admin=TRUE OR Enabled=TRUE) AND (@search IS NULL OR Name LIKE @search) ORDER BY Id LIMIT @limit OFFSET @offset", ("kind", kind), ("admin", actor.IsBackOffice), ("search", query.Search is null ? null : "%" + query.Search + "%"), ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
    public async Task<object> Users(Actor actor, PageQuery query)
    {
        actor.RequirePermission("users.read"); Validate(query);
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT u.Id,u.Username,u.Name,u.Phone,u.Enabled,(u.OpenId IS NOT NULL) AS Bound,GROUP_CONCAT(r.Role ORDER BY r.Role) AS Roles FROM Users u LEFT JOIN UserRoles r ON r.UserId=u.Id GROUP BY u.Id ORDER BY u.Id LIMIT @limit OFFSET @offset", ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
    public async Task<DocumentPage> Documents(Actor actor, string kind, PageQuery query)
    {
        DocumentServiceAuthorization(actor, kind); Validate(query);
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT d.* FROM Documents d WHERE d.Kind=@kind AND (@admin=TRUE OR CreatorId=@actor) AND (@from IS NULL OR BusinessDate>=@from) AND (@to IS NULL OR BusinessDate<=@to) ORDER BY d.Id " + (query.Sort == "asc" ? "ASC" : "DESC") + " LIMIT @limit OFFSET @offset", ("kind", kind), ("admin", actor.IsBackOffice), ("actor", actor.Id), ("from", query.From?.ToString("yyyy-MM-dd")), ("to", query.To?.ToString("yyyy-MM-dd")), ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new DocumentPage(rows.Select(DocumentRepository.Read).ToArray(), query.Page, query.PageSize);
    }
    private static void DocumentServiceAuthorization(Actor actor, string kind) => Services.DocumentService.Authorize(actor, kind);
    public async Task<object> Document(Actor actor, string kind, long id)
    {
        await using var connection = await database.Open();
        var document = await new DocumentRepository().Get(connection, null, id);
        Services.DocumentService.Own(actor, document);
        if (kind != document.Kind)
        {
            throw new BusinessException(404, "NOT_FOUND", "未找到单据");
        }

        var items = await Database.Query(connection, null, "SELECT i.*,b.GrowerName,i.Quantity AS ActualQuantity,CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(d.Payload,'$.mode'))='DIRECT' AND d.Kind='OUTBOUND' THEN -i.Quantity ELSE i.Quantity END AS DisplayQuantity FROM DocumentItems i JOIN Documents d ON d.Id=i.DocumentId LEFT JOIN WorkBatches b ON b.Id=i.BatchId WHERE DocumentId=@id ORDER BY i.Id", ("id", id));
        var context = document.Input.BatchId is null ? null : (await Database.Query(connection, null,
            "SELECT b.GrowerName,u.Name AS DriverName FROM WorkBatches b JOIN Users u ON u.Id=b.DriverId WHERE b.Id=@batch", ("batch", document.Input.BatchId))).FirstOrDefault()?.Output();
        return new { document, items = items.Select(row => row.Output()), context };
    }
    public async Task<object> Inventory(Actor actor, bool packaging, PageQuery query)
    {
        if (actor.IsBackOffice) actor.RequirePermission("inventory.read");
        else actor.Require(packaging ? Roles.Admin : Roles.Outbound);
        Validate(query);
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT a.Id,a.Name,a.Unit,a.Specification,a.Enabled,b.Quantity,b.Version FROM Archives a JOIN InventoryBalances b ON b.ItemId=a.Id WHERE a.Kind=@kind AND (@item IS NULL OR a.Id=@item) ORDER BY a.Id LIMIT @limit OFFSET @offset", ("kind", packaging ? ArchiveKinds.Packaging : InventoryDomains.Vegetable), ("item", query.ItemId), ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
    public async Task<object> Batches(Actor actor, long? id, PageQuery query)
    {
        if (actor.IsBackOffice) actor.RequirePermission("batches.read");
        else actor.Require(Roles.Driver, Roles.Worker);
        Validate(query);
        await using var connection = await database.Open();
        var worker = !actor.IsBackOffice && actor.SelectedRole == Roles.Worker && actor.Roles.Contains(Roles.Worker);
        var rows = await Database.Query(connection, null, "SELECT b.Id,b.DispatchId,b.GrowerId,b.GrowerName,b.Status,b.Version,d.Number,d.BusinessDate,u.Name AS DriverName FROM WorkBatches b JOIN Documents d ON d.Id=b.DispatchId JOIN Users u ON u.Id=b.DriverId WHERE d.Status='POSTED' AND (@id IS NULL OR b.Id=@id) AND (@admin=TRUE OR b.DriverId=@actor OR (@worker=TRUE AND b.Status='OPEN')) AND (@grower IS NULL OR b.GrowerId=@grower) AND (@search IS NULL OR b.GrowerName LIKE @search) AND (@from IS NULL OR d.BusinessDate>=@from) AND (@to IS NULL OR d.BusinessDate<=@to) ORDER BY b.Id DESC LIMIT @limit OFFSET @offset", ("id", id), ("admin", actor.IsBackOffice), ("actor", actor.Id), ("worker", worker), ("grower", query.GrowerId), ("search", query.Search is null ? null : "%" + query.Search + "%"), ("from", query.From?.ToString("yyyy-MM-dd")), ("to", query.To?.ToString("yyyy-MM-dd")), ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        if (id is null)
        {
            return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
        }

        if (rows.Count == 0)
        {
            throw new BusinessException(404, "NOT_FOUND", "未找到可用批次");
        }

        var packaging = await Database.Query(connection, null, "SELECT p.ItemId,a.Name,a.Unit,p.Outstanding" + (worker ? "" : ",p.Dispatched,p.Consumed,p.Recovered,p.Lost") + " FROM BatchPackagingBalances p JOIN Archives a ON a.Id=p.ItemId WHERE p.BatchId=@batch ORDER BY p.ItemId", ("batch", id));
        var vegetables = worker ? [] : await Database.Query(connection, null, "SELECT v.ItemId,a.Name,a.Unit,v.Output,v.Received,v.Output-v.Received AS Difference FROM BatchVegetableBalances v JOIN Archives a ON a.Id=v.ItemId WHERE v.BatchId=@batch ORDER BY v.ItemId", ("batch", id));
        return new { batch = rows[0].Output(), packaging = packaging.Select(row => row.Output()), vegetables = vegetables.Select(row => row.Output()) };
    }
    public async Task<object> Submission(Actor actor, string operation, string key)
    {
        if (operation.Length > 100 || key.Length > 100)
        {
            throw BusinessException.Invalid("提交查询参数过长");
        }

        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT ResultJson FROM IdempotencyRecords WHERE UserId=@actor AND Operation=@operation AND IdempotencyKey=@key", ("actor", actor.Id), ("operation", operation), ("key", key));
        if (rows.Count > 0 && !rows[0].IsNull("ResultJson"))
        {
            return new { status = "SUCCEEDED", result = System.Text.Json.JsonSerializer.Deserialize<object>(rows[0].Text("ResultJson")) };
        }
        var attempts = await Database.Query(connection, null,
            "SELECT State,FailureCode FROM SubmissionAttempts WHERE UserId=@actor AND Operation=@operation AND IdempotencyKey=@key",
            ("actor", actor.Id), ("operation", operation), ("key", key));
        if (attempts.Count == 0)
        {
            return new { status = "NOT_SUBMITTED", result = (object?)null };
        }
        // 在途或结果未知统一 PENDING；不要让客户端生成新 key 造成重复入账。
        return new { status = attempts[0].Text("State"), failureCode = attempts[0].Text("FailureCode"), result = (object?)null };
    }
    public async Task<object> Audits(Actor actor, PageQuery query)
    {
        actor.Require(Roles.Admin); Validate(query);
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT a.*,u.Name AS ActorName,u.Username FROM AuditLogs a JOIN Users u ON u.Id=a.ActorId WHERE (@from IS NULL OR a.CreatedAt>=@from) AND (@to IS NULL OR a.CreatedAt<@to) AND (@actor IS NULL OR a.ActorId=@actor) AND (@action IS NULL OR a.Action=@action) AND (@request IS NULL OR a.RequestId=@request) ORDER BY a.Id DESC LIMIT @limit OFFSET @offset", ("from", query.From is null ? null : TimeZoneInfo.ConvertTimeToUtc(query.From.Value.ToDateTime(TimeOnly.MinValue), TimeZoneInfo.FindSystemTimeZoneById(settings.TimeZone))), ("to", query.To is null ? null : TimeZoneInfo.ConvertTimeToUtc(query.To.Value.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeZoneInfo.FindSystemTimeZoneById(settings.TimeZone))), ("actor", query.ActorId), ("action", query.Action), ("request", query.RequestId), ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
    public async Task<object> BindingRequests(Actor actor, PageQuery query)
    {
        actor.Require(Roles.Admin); Validate(query);
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT Id,Status,CandidateUserId,ApprovedBy,Reason,ExpiresAt,CreatedAt FROM Bindings WHERE Status IN ('PENDING_APPROVAL','APPROVED','REJECTED') ORDER BY Id DESC LIMIT @limit OFFSET @offset", ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }

    public async Task<List<Row>> DataExport(Actor actor, string resource, PageQuery query)
    {
        Validate(query);
        var archives = new Dictionary<string, string> { ["growers"] = ArchiveKinds.Grower, ["packaging-types"] = ArchiveKinds.Packaging,
            ["vegetable-types"] = InventoryDomains.Vegetable, ["customers"] = ArchiveKinds.Customer };
        var documents = new Dictionary<string, string> { ["dispatches"] = DocumentKinds.Dispatch, ["work-records"] = DocumentKinds.Work,
            ["recoveries"] = DocumentKinds.Recovery, ["outbounds"] = DocumentKinds.Outbound, ["stock-documents"] = DocumentKinds.Stock };
        string module;
        string sql;
        string? kind = null;
        if (archives.TryGetValue(resource, out kind))
        {
            module = "archives";
            sql = "SELECT Id,Kind,Name,Unit,Specification,Contact,Phone,Enabled FROM Archives WHERE Kind=@kind AND (@search IS NULL OR Name LIKE @search) ORDER BY Id LIMIT 50001";
        }
        else if (documents.TryGetValue(resource, out kind))
        {
            module = "documents";
            sql = "SELECT d.* FROM Documents d WHERE Kind=@kind AND (@from IS NULL OR BusinessDate>=@from) AND (@to IS NULL OR BusinessDate<=@to) ORDER BY d.Id " + (query.Sort == "asc" ? "ASC" : "DESC") + " LIMIT 50001";
        }
        else if (resource == "users")
        {
            module = "users";
            sql = "SELECT u.Id,u.Username,u.Name,u.Phone,u.Enabled,(u.OpenId IS NOT NULL) AS Bound,GROUP_CONCAT(r.Role ORDER BY r.Role) AS Roles FROM Users u LEFT JOIN UserRoles r ON r.UserId=u.Id GROUP BY u.Id ORDER BY u.Id LIMIT 50001";
        }
        else if (resource is "inventory-packaging" or "inventory-vegetables")
        {
            module = "inventory";
            kind = resource == "inventory-packaging" ? ArchiveKinds.Packaging : InventoryDomains.Vegetable;
            sql = "SELECT a.Id,a.Name,a.Unit,a.Specification,a.Enabled,b.Quantity FROM Archives a JOIN InventoryBalances b ON b.ItemId=a.Id WHERE a.Kind=@kind AND (@item IS NULL OR a.Id=@item) ORDER BY a.Id LIMIT 50001";
        }
        else if (resource == "batches")
        {
            module = "batches";
            sql = "SELECT b.Id,d.Number,d.BusinessDate,b.GrowerName,u.Name AS DriverName,b.Status FROM WorkBatches b JOIN Documents d ON d.Id=b.DispatchId JOIN Users u ON u.Id=b.DriverId WHERE d.Status='POSTED' AND (@grower IS NULL OR b.GrowerId=@grower) AND (@driver IS NULL OR b.DriverId=@driver) AND (@search IS NULL OR b.GrowerName LIKE @search) AND (@from IS NULL OR d.BusinessDate>=@from) AND (@to IS NULL OR d.BusinessDate<=@to) ORDER BY b.Id DESC LIMIT 50001";
        }
        else throw new BusinessException(404, "NOT_FOUND", "未知导出数据类型");
        actor.RequirePermission(module + ".read");
        actor.RequirePermission(module + ".export");
        await using var connection = await database.Open();
        await using var snapshot = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var rows = await Database.Query(connection, snapshot, sql, ("kind", kind), ("from", query.From?.ToString("yyyy-MM-dd")),
            ("to", query.To?.ToString("yyyy-MM-dd")), ("search", query.Search is null ? null : "%" + query.Search + "%"),
            ("item", query.ItemId), ("grower", query.GrowerId), ("driver", query.DriverId));
        if (rows.Count > 50000) throw new BusinessException(422, "EXPORT_LIMIT", "导出超过 50,000 行，请缩小筛选范围");
        if (module == "documents")
        {
            var dictionary = (await Database.Query(connection, snapshot, "SELECT Id,Name,Unit FROM Archives"))
                .ToDictionary(row => row.Id("Id"));
            var snapshots = (await Database.Query(connection, snapshot,
                "SELECT i.DocumentId,i.ItemId,i.LineKind,i.ItemName,i.Unit FROM DocumentItems i JOIN Documents d ON d.Id=i.DocumentId WHERE d.Kind=@kind AND (@from IS NULL OR d.BusinessDate>=@from) AND (@to IS NULL OR d.BusinessDate<=@to)",
                ("kind", kind), ("from", query.From?.ToString("yyyy-MM-dd")), ("to", query.To?.ToString("yyyy-MM-dd"))))
                .GroupBy(row => (row.Id("DocumentId"), row.Id("ItemId"), row.Text("LineKind")))
                .ToDictionary(group => group.Key, group => group.First());
            var flattened = new List<Row>();
            foreach (var row in rows)
            {
                var doc = DocumentRepository.Read(row);
                var lines = doc.Input.Items.Select(line => (Line: line, Type: "ITEM"))
                    .Concat((doc.Input.Vegetables ?? []).Select(line => (Line: line, Type: doc.Kind == DocumentKinds.Work ? "OUTPUT" : "RECEIVED"))).ToArray();
                if (lines.Length == 0) lines = [(new QuantityLine(0, 0), "ITEM")];
                foreach (var entry in lines)
                {
                    var lineKind = entry.Type == "ITEM" ? doc.Kind switch { DocumentKinds.Dispatch => ArchiveKinds.Packaging, DocumentKinds.Work => "CONSUMPTION", DocumentKinds.Recovery => "RECOVERY_PACKAGING", DocumentKinds.Outbound => DocumentKinds.Outbound, _ => DocumentKinds.Stock } : entry.Type;
                    var item = snapshots.GetValueOrDefault((doc.Id, entry.Line.ItemId, lineKind));
                    var archive = dictionary.GetValueOrDefault(entry.Line.ItemId);
                    flattened.Add(new Row(new Dictionary<string, object?> { ["Number"] = doc.Number, ["BusinessDate"] = doc.Input.BusinessDate.ToString("yyyy-MM-dd"),
                        ["Kind"] = doc.Kind, ["Status"] = doc.Status, ["CreatorName"] = doc.CreatorName, ["CustomerName"] = doc.CustomerName,
                        ["ItemId"] = entry.Line.ItemId, ["Name"] = item?.Text("ItemName") ?? archive?.Text("Name") ?? "", ["Unit"] = item?.Text("Unit") ?? archive?.Text("Unit") ?? "",
                        ["LineKind"] = lineKind, ["Quantity"] = entry.Line.Quantity, ["DisplayQuantity"] = doc.Kind == DocumentKinds.Outbound && doc.Input.Mode == OutboundModes.Direct ? -entry.Line.Quantity : entry.Line.Quantity,
                        ["GrowerId"] = entry.Line.GrowerId, ["GrowerName"] = entry.Line.GrowerId is long grower ? dictionary.GetValueOrDefault(grower)?.Text("Name") : "", ["BatchId"] = doc.Input.BatchId, ["Mode"] = doc.Input.Mode, ["Source"] = doc.Input.Source,
                        ["Direction"] = entry.Line.Direction, ["Remark"] = doc.Input.Remark, ["LossReason"] = doc.Input.LossReason, ["DifferenceReason"] = doc.Input.DifferenceReason }));
                    if (flattened.Count > 50000) throw new BusinessException(422, "EXPORT_LIMIT", "单据明细导出超过 50,000 行，请缩小日期范围");
                }
            }
            rows = flattened;
        }
        await snapshot.CommitAsync();
        return rows;
    }
}
