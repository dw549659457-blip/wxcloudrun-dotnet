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
        if (!actor.IsAdmin)
        {
            var allowed = kind switch { ArchiveKinds.Packaging => new[] { Roles.Driver, Roles.Worker }, ArchiveKinds.Grower => new[] { Roles.Driver, Roles.Worker }, InventoryDomains.Vegetable => new[] { Roles.Driver, Roles.Worker, Roles.Outbound }, ArchiveKinds.Customer => new[] { Roles.Outbound }, _ => Array.Empty<string>() };
            actor.Require(allowed);
        }
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT Id,Kind,Name,Unit,Specification,Enabled" + (actor.IsAdmin ? ",Contact,Phone" : "") + " FROM Archives WHERE Kind=@kind AND (@admin=TRUE OR Enabled=TRUE) AND (@search IS NULL OR Name LIKE @search) ORDER BY Id LIMIT @limit OFFSET @offset", ("kind", kind), ("admin", actor.IsAdmin), ("search", query.Search is null ? null : "%" + query.Search + "%"), ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
    public async Task<object> Users(Actor actor, PageQuery query)
    {
        actor.Require(Roles.Admin); Validate(query);
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT u.Id,u.Username,u.Name,u.Phone,u.Enabled,(u.OpenId IS NOT NULL) AS Bound,GROUP_CONCAT(r.Role ORDER BY r.Role) AS Roles FROM Users u LEFT JOIN UserRoles r ON r.UserId=u.Id GROUP BY u.Id ORDER BY u.Id LIMIT @limit OFFSET @offset", ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
    public async Task<DocumentPage> Documents(Actor actor, string kind, PageQuery query)
    {
        DocumentServiceAuthorization(actor, kind); Validate(query);
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT d.* FROM Documents d WHERE d.Kind=@kind AND (@admin=TRUE OR CreatorId=@actor) AND (@from IS NULL OR BusinessDate>=@from) AND (@to IS NULL OR BusinessDate<=@to) ORDER BY d.Id " + (query.Sort == "asc" ? "ASC" : "DESC") + " LIMIT @limit OFFSET @offset", ("kind", kind), ("admin", actor.IsAdmin), ("actor", actor.Id), ("from", query.From?.ToString("yyyy-MM-dd")), ("to", query.To?.ToString("yyyy-MM-dd")), ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
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

        var items = await Database.Query(connection, null, "SELECT i.*,i.Quantity AS ActualQuantity,CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(d.Payload,'$.mode'))='DIRECT' AND d.Kind='OUTBOUND' THEN -i.Quantity ELSE i.Quantity END AS DisplayQuantity FROM DocumentItems i JOIN Documents d ON d.Id=i.DocumentId WHERE DocumentId=@id ORDER BY i.Id", ("id", id));
        return new { document, items = items.Select(row => row.Output()) };
    }
    public async Task<object> Inventory(Actor actor, bool packaging, PageQuery query)
    {
        actor.Require(packaging ? Roles.Admin : Roles.Outbound); Validate(query);
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT a.Id,a.Name,a.Unit,a.Specification,a.Enabled,b.Quantity,b.Version FROM Archives a JOIN InventoryBalances b ON b.ItemId=a.Id WHERE a.Kind=@kind AND (@item IS NULL OR a.Id=@item) ORDER BY a.Id LIMIT @limit OFFSET @offset", ("kind", packaging ? ArchiveKinds.Packaging : InventoryDomains.Vegetable), ("item", query.ItemId), ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
    public async Task<object> Batches(Actor actor, long? id, PageQuery query)
    {
        actor.Require(Roles.Driver, Roles.Worker); Validate(query);
        await using var connection = await database.Open();
        var worker = !actor.IsAdmin && actor.SelectedRole == Roles.Worker && actor.Roles.Contains(Roles.Worker);
        var rows = await Database.Query(connection, null, "SELECT b.Id,b.DispatchId,b.GrowerId,b.GrowerName,b.Status,b.Version,d.Number,d.BusinessDate,u.Name AS DriverName FROM WorkBatches b JOIN Documents d ON d.Id=b.DispatchId JOIN Users u ON u.Id=b.DriverId WHERE d.Status='POSTED' AND (@id IS NULL OR b.Id=@id) AND (@admin=TRUE OR b.DriverId=@actor OR (@worker=TRUE AND b.Status='OPEN')) AND (@grower IS NULL OR b.GrowerId=@grower) AND (@search IS NULL OR b.GrowerName LIKE @search) AND (@from IS NULL OR d.BusinessDate>=@from) AND (@to IS NULL OR d.BusinessDate<=@to) ORDER BY b.Id DESC LIMIT @limit OFFSET @offset", ("id", id), ("admin", actor.IsAdmin), ("actor", actor.Id), ("worker", worker), ("grower", query.GrowerId), ("search", query.Search is null ? null : "%" + query.Search + "%"), ("from", query.From?.ToString("yyyy-MM-dd")), ("to", query.To?.ToString("yyyy-MM-dd")), ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
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
        var rows = await Database.Query(connection, null, "SELECT * FROM AuditLogs WHERE (@from IS NULL OR CreatedAt>=@from) AND (@to IS NULL OR CreatedAt<@to) ORDER BY Id DESC LIMIT @limit OFFSET @offset", ("from", query.From is null ? null : TimeZoneInfo.ConvertTimeToUtc(query.From.Value.ToDateTime(TimeOnly.MinValue), TimeZoneInfo.FindSystemTimeZoneById(settings.TimeZone))), ("to", query.To is null ? null : TimeZoneInfo.ConvertTimeToUtc(query.To.Value.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeZoneInfo.FindSystemTimeZoneById(settings.TimeZone))), ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
    public async Task<object> BindingRequests(Actor actor, PageQuery query)
    {
        actor.Require(Roles.Admin); Validate(query);
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT Id,Status,CandidateUserId,ApprovedBy,Reason,ExpiresAt,CreatedAt FROM Bindings WHERE Status IN ('PENDING_APPROVAL','APPROVED','REJECTED') ORDER BY Id DESC LIMIT @limit OFFSET @offset", ("limit", query.PageSize), ("offset", (query.Page - 1) * query.PageSize));
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
}
