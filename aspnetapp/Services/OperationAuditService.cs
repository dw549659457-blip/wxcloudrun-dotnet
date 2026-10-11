using aspnetapp.Configuration;
using aspnetapp.Domain;
using aspnetapp.Infrastructure;

namespace aspnetapp.Services;

public sealed class OperationAuditService(Database database, AppSettings settings)
{
    private static readonly string[] SafeQueryKeys = ["page", "pageSize", "from", "to", "sort", "itemId", "growerId", "driverId", "source", "search", "version", "actorId", "action", "module", "statusCode", "role", "requestId", "operation"];
    public static (string Action, string Module) Describe(HttpRequest request)
    {
        var path = request.Path.Value ?? "";
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var module = segments.ElementAtOrDefault(1) ?? "unknown";
        if (module == "admin") module = segments.ElementAtOrDefault(2) == "reconcile" ? "reconcile" : "documents";
        var exporting = module == "exports";
        if (exporting)
        {
            module = segments.ElementAtOrDefault(2) ?? "unknown";
            if (module.StartsWith("inventory-", StringComparison.Ordinal)) module = "inventory";
        }
        var action = path.EndsWith("/excel", StringComparison.Ordinal) || exporting ? "EXPORT"
            : path.EndsWith("/admin-login", StringComparison.Ordinal) ? "LOGIN"
            : path.EndsWith("/logout", StringComparison.Ordinal) ? "LOGOUT"
            : path.EndsWith("/reverse", StringComparison.Ordinal) ? "REVERSE"
            : path.EndsWith("/correct", StringComparison.Ordinal) ? "CORRECT"
            : path.EndsWith("/post", StringComparison.Ordinal) ? "POST"
            : module == "backoffice-permissions" && request.Method == "PUT" ? "CONFIGURE"
            : request.Method switch { "GET" => "READ", "POST" => "CREATE", "PUT" or "PATCH" => "UPDATE", "DELETE" => "DELETE", _ => request.Method };
        return (action, module);
    }
    public async Task<long> Start(HttpContext context, Actor actor)
    {
        var (action, module) = Describe(context.Request);
        // 仅保存明确允许的筛选项，绝不记录请求体、密码、Cookie、令牌或幂等密钥。
        var query = context.Request.Query.Where(pair => SafeQueryKeys.Contains(pair.Key, StringComparer.OrdinalIgnoreCase))
            .ToDictionary(pair => pair.Key, pair => pair.Value.ToString()[..Math.Min(pair.Value.ToString().Length, 150)]);
        await using var connection = await database.Open();
        await using var transaction = await connection.BeginTransactionAsync();
        var id = await Database.Insert(connection, transaction,
            "INSERT INTO BackOfficeOperationLogs(ActorId,Username,ActorName,ActorRoles,Action,Module,Method,Path,QueryJson,RequestId,CreatedAt) VALUES(@actor,@username,@name,@roles,@action,@module,@method,@path,@query,@request,UTC_TIMESTAMP(6))",
            ("actor", actor.Id), ("username", actor.Username), ("name", actor.Name), ("roles", string.Join(',', actor.Roles)),
            ("action", action), ("module", module[..Math.Min(module.Length, 80)]), ("method", context.Request.Method),
            ("path", context.Request.Path.Value?[..Math.Min(context.Request.Path.Value.Length, 240)] ?? ""),
            ("query", JsonSettings.Serialize(query)), ("request", context.TraceIdentifier));
        await transaction.CommitAsync();
        return id;
    }
    public async Task Complete(long id, int status, string? errorCode, long duration)
    {
        await using var connection = await database.Open();
        await Database.Execute(connection, null,
            "UPDATE BackOfficeOperationLogs SET StatusCode=@status,State='COMPLETED',ErrorCode=@error,DurationMs=@duration,CompletedAt=UTC_TIMESTAMP(6) WHERE Id=@id",
            [("status", status), ("error", errorCode), ("duration", duration), ("id", id)]);
    }
    public async Task<List<Row>> Rows(Actor actor, PageQuery query, bool export = false)
    {
        actor.Require(Roles.Admin);
        Repositories.QueryRepository.Validate(query);
        if ((query.Action?.Length ?? 0) > 20 || (query.Module?.Length ?? 0) > 80 || (query.Role?.Length ?? 0) > 16 || (query.RequestId?.Length ?? 0) > 64)
            throw BusinessException.Invalid("审计筛选参数过长");
        var timezone = TimeZoneInfo.FindSystemTimeZoneById(settings.TimeZone);
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null,
            "SELECT * FROM BackOfficeOperationLogs WHERE (@from IS NULL OR CreatedAt>=@from) AND (@to IS NULL OR CreatedAt<@to) AND (@actor IS NULL OR ActorId=@actor) AND (@action IS NULL OR Action=@action) AND (@module IS NULL OR Module=@module) AND (@status IS NULL OR StatusCode=@status) AND (@role IS NULL OR FIND_IN_SET(@role,ActorRoles)>0) AND (@request IS NULL OR RequestId=@request) AND (@search IS NULL OR Username LIKE @search OR ActorName LIKE @search OR Path LIKE @search) ORDER BY Id DESC LIMIT @limit OFFSET @offset",
            ("from", query.From is null ? null : TimeZoneInfo.ConvertTimeToUtc(query.From.Value.ToDateTime(TimeOnly.MinValue), timezone)),
            ("to", query.To is null ? null : TimeZoneInfo.ConvertTimeToUtc(query.To.Value.AddDays(1).ToDateTime(TimeOnly.MinValue), timezone)),
            ("actor", query.ActorId), ("action", query.Action), ("module", query.Module), ("status", query.StatusCode),
            ("role", query.Role), ("request", query.RequestId), ("search", query.Search is null ? null : "%" + query.Search + "%"),
            ("limit", export ? 50001 : query.PageSize), ("offset", export ? 0 : (query.Page - 1) * query.PageSize));
        if (export && rows.Count > 50000) throw new BusinessException(422, "EXPORT_LIMIT", "导出超过 50,000 行，请缩小日期或操作者范围");
        return rows;
    }
}
