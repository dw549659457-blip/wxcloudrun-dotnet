using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using MySqlConnector;

namespace aspnetapp.Repositories;

public sealed class DocumentRepository
{
    public async Task<DocumentRecord> Get(MySqlConnection connection, MySqlTransaction? transaction, long id, bool locked = false)
    {
        var rows = await Database.Query(connection, transaction, "SELECT * FROM Documents WHERE Id=@id" + (locked ? " FOR UPDATE" : ""), ("id", id));
        if (rows.Count == 0)
        {
            throw new BusinessException(404, "NOT_FOUND", "未找到单据");
        }

        return Read(rows[0]);
    }
    public static DocumentRecord Read(Row row) => new(row.Id("Id"), row.Text("Number"), row.Text("Kind"), row.Id("CreatorId"), row.Text("Status"), (int)row.Id("Version"), JsonSettings.Deserialize<DocumentInput>(row.Text("Payload")), row.IsNull("ReplacesId") ? null : row.Id("ReplacesId"), row.Text("CreatorName"), DateTime.SpecifyKind(row.DateTime("CreatedAt"), DateTimeKind.Utc), row.IsNull("PostedAt") ? null : DateTime.SpecifyKind(row.DateTime("PostedAt"), DateTimeKind.Utc), row.IsNull("CustomerName") ? null : row.Text("CustomerName"));
    public async Task<DocumentRecord> Create(MySqlConnection connection, MySqlTransaction transaction, string kind, long creatorId, DocumentInput input, long? replacesId = null)
    {
        var number = $"{kind}-{DateTime.UtcNow:yyyyMMdd}-{Guid.NewGuid():N}";
        var id = await Database.Insert(connection, transaction,
            "INSERT INTO Documents(Number,Kind,CreatorId,BusinessDate,Status,Payload,ReplacesId,CreatorName,CreatedAt) VALUES(@number,@kind,@actor,@date,'DRAFT',@payload,@replaces,(SELECT Name FROM Users WHERE Id=@actor),UTC_TIMESTAMP(6))",
            ("number", number), ("kind", kind), ("actor", creatorId), ("date", input.BusinessDate.ToString("yyyy-MM-dd")), ("payload", JsonSettings.Serialize(input)), ("replaces", replacesId));
        return await Get(connection, transaction, id);
    }
    public Task AddLine(MySqlConnection connection, MySqlTransaction transaction, long documentId, string lineKind, QuantityLine line, Row archive, long? batchId = null) => Database.Insert(connection, transaction,
        "INSERT INTO DocumentItems(DocumentId,LineKind,ItemId,GrowerId,BatchId,Quantity,Direction,ItemName,Unit,Specification) VALUES(@document,@kind,@item,@grower,@batch,@quantity,@direction,@name,@unit,@specification)",
        ("document", documentId), ("kind", lineKind), ("item", line.ItemId), ("grower", line.GrowerId), ("batch", batchId), ("quantity", line.Quantity), ("direction", line.Direction), ("name", archive.Text("Name")), ("unit", archive.Text("Unit")), ("specification", archive.Text("Specification")));
    public Task Audit(MySqlConnection connection, MySqlTransaction transaction, Actor actor, string action, string entity, long id, object? before, object? after, string reason, string requestId) => Database.Insert(connection, transaction,
        "INSERT INTO AuditLogs(ActorId,Action,EntityType,EntityId,BeforeJson,AfterJson,Reason,RequestId,CreatedAt) VALUES(@actor,@action,@entity,@id,@before,@after,@reason,@request,UTC_TIMESTAMP(6))",
        ("actor", actor.Id), ("action", action), ("entity", entity), ("id", id), ("before", before is null ? null : JsonSettings.Serialize(before)), ("after", after is null ? null : JsonSettings.Serialize(after)), ("reason", reason), ("request", requestId));
}
