using aspnetapp.Configuration;
using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using MySqlConnector;

namespace aspnetapp.Services;

public sealed class StockNotificationService(Database database, TransactionService transactions, NotificationSettings settings)
{
    private volatile bool installed;
    private static void Admin(Actor actor) => actor.Require(Roles.Admin);
    private async Task<bool> Installed(MySqlConnection connection, MySqlTransaction? transaction)
    {
        if (installed) return true;
        var rows = await Database.Query(connection, transaction, "SELECT Name FROM SchemaMigrations WHERE Name='006_stock_notifications.sql'");
        if (rows.Count == 0) return false;
        installed = true;
        return true;
    }
    public async Task<bool> Installed()
    {
        if (installed) return true;
        await using var connection = await database.Open();
        return await Installed(connection, null);
    }
    private async Task RequireInstalled()
    {
        if (!await Installed()) throw new BusinessException(503, "NOTIFICATIONS_NOT_READY", "库存动态尚未启用，请执行006数据库升级SQL；原记账功能可继续使用");
    }
    public async Task Capture(MySqlConnection connection, MySqlTransaction transaction, Actor actor, DocumentRecord document, string action)
    {
        // 兼容先部署新代码、随后升级已有云库；006登记成功后，事件必须和入账原子提交。
        if (!await Installed(connection, transaction)) return;
        var rows = await Database.Query(connection, transaction,
            "SELECT l.ItemId,l.ItemName,l.Unit,l.Domain,SUM(l.Delta) AS Delta,i.Quantity AS Balance FROM InventoryLedger l " +
            "LEFT JOIN InventoryBalances i ON i.ItemId=l.ItemId WHERE l.DocumentId=@id AND " +
            (action == "POST" ? "l.ReversalOf IS NULL" : "l.ReversalOf IS NOT NULL") +
            " GROUP BY l.ItemId,l.ItemName,l.Unit,l.Domain,i.Quantity ORDER BY l.Domain,l.ItemId", ("id", document.Id));
        var lines = rows.Select(row => new NotificationLine(row.Id("ItemId"), row.Text("ItemName"), row.Text("Unit"), row.Text("Domain"),
            row.Quantity("Delta"), row.Text("Domain") == InventoryDomains.ExternalPackaging ? null : row.Quantity("Balance"))).ToList();
        if (document.Kind == DocumentKinds.Work)
        {
            var output = await Database.Query(connection, transaction, "SELECT ItemId,ItemName,Unit,Quantity FROM DocumentItems WHERE DocumentId=@id AND LineKind='OUTPUT' ORDER BY ItemId", ("id", document.Id));
            lines.AddRange(output.Select(row => new NotificationLine(row.Id("ItemId"), row.Text("ItemName"), row.Text("Unit"), "OUTPUT",
                (action == "POST" ? 1 : -1) * row.Quantity("Quantity"), null)));
        }
        var names = await Database.Query(connection, transaction,
            "SELECT DISTINCT b.GrowerName AS Name FROM WorkBatches b WHERE b.DispatchId=@id OR b.Id=@batch ORDER BY b.GrowerName",
            ("id", document.Id), ("batch", document.Input.BatchId));
        var customer = await Database.Query(connection, transaction, "SELECT CustomerName FROM Documents WHERE Id=@id", ("id", document.Id));
        var party = !customer[0].IsNull("CustomerName") ? customer[0].Text("CustomerName") : string.Join("、", names.Select(row => row.Text("Name")));
        var title = document.Kind switch { DocumentKinds.Work => "装菜登记", DocumentKinds.Recovery => "回收入库", DocumentKinds.Outbound => "发货出库", DocumentKinds.Dispatch => "包装派发", _ => "库存变动" };
        if (action == "REVERSE") title += "（冲销）";
        var notification = new StockNotification(0, document.Id, document.Number, document.Kind, action, title, actor.Name, party,
            document.Input.BusinessDate.ToString("yyyy-MM-dd"), DateTime.UtcNow, lines.ToArray(), lines.Count);
        var id = await Database.Insert(connection, transaction,
            "INSERT INTO StockNotifications(DocumentId,Action,Payload,CreatedAt) VALUES(@document,@action,@payload,UTC_TIMESTAMP(6))",
            ("document", document.Id), ("action", action), ("payload", JsonSettings.Serialize(notification)));
        if (!settings.Configured) return;
        // 入账和待发送任务同一事务；微信调用只在事务提交后的后台服务中执行。
        var grants = await Database.Query(connection, transaction,
            "SELECT g.* FROM WechatNotificationGrants g JOIN Users u ON u.Id=g.UserId " +
            "LEFT JOIN WechatNotificationPreferences p ON p.UserId=g.UserId WHERE g.State='AVAILABLE' " +
            "AND g.TemplateId=@template AND u.Enabled=TRUE AND u.AppId=g.AppId AND u.OpenId=g.OpenId " +
            "AND COALESCE(p.Paused,FALSE)=FALSE AND EXISTS(SELECT 1 FROM UserRoles r WHERE r.UserId=u.Id AND r.Role='ADMIN') ORDER BY g.Id FOR UPDATE", ("template", settings.TemplateId));
        foreach (var grant in grants.DistinctBy(row => row.Id("UserId")))
        {
            await Database.Execute(connection, transaction, "UPDATE WechatNotificationGrants SET State='RESERVED' WHERE Id=@id", [("id", grant.Id("Id"))]);
            await Database.Execute(connection, transaction,
                "INSERT INTO WechatNotificationDeliveries(NotificationId,UserId,GrantId,TemplateId,Fields,MiniprogramState,NextAttemptAt,CreatedAt) VALUES(@event,@user,@grant,@template,@fields,@state,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",
                [("event", id), ("user", grant.Id("UserId")), ("grant", grant.Id("Id")), ("template", settings.TemplateId),
                    ("fields", JsonSettings.Serialize(settings.Fields)), ("state", settings.MiniprogramState)]);
        }
    }
    private static StockNotification Read(Row row) => JsonSettings.Deserialize<StockNotification>(row.Text("Payload")) with { Id = row.Id("Id") };
    public async Task<object> Feed(Actor actor, long before = 0, int limit = 20)
    {
        Admin(actor);
        await RequireInstalled();
        if (before < 0 || limit is < 1 or > 50) throw BusinessException.Invalid("动态分页参数无效");
        await using var connection = await database.Open();
        await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var counts = (await Database.Query(connection, transaction,
            "SELECT COALESCE(MAX(n.Id),0) AS LatestId,COUNT(CASE WHEN r.NotificationId IS NULL THEN 1 END) AS UnreadCount FROM StockNotifications n LEFT JOIN StockNotificationReads r ON r.NotificationId=n.Id AND r.UserId=@user", ("user", actor.Id)))[0];
        var rows = await Database.Query(connection, transaction,
            "SELECT n.*,r.NotificationId AS ReadId FROM StockNotifications n LEFT JOIN StockNotificationReads r ON r.NotificationId=n.Id AND r.UserId=@user WHERE (@before=0 OR n.Id<@before) ORDER BY n.Id DESC LIMIT @limit",
            ("user", actor.Id), ("before", before), ("limit", limit + 1));
        var subscription = await SubscriptionStatus(connection, transaction, actor.Id);
        await transaction.CommitAsync();
        return new { items = rows.Take(limit).Select(row => new { notification = Read(row) with { Lines = Read(row).Lines.Take(3).ToArray() }, isRead = !row.IsNull("ReadId") }),
            latestId = counts.Id("LatestId"), unreadCount = counts.Id("UnreadCount"), hasMore = rows.Count > limit,
            subscription, updatedAt = DateTime.UtcNow };
    }
    public async Task<StockNotification> Detail(Actor actor, long id)
    {
        Admin(actor);
        await RequireInstalled();
        await using var connection = await database.Open();
        var rows = await Database.Query(connection, null, "SELECT * FROM StockNotifications WHERE Id=@id", ("id", id));
        if (rows.Count == 0) throw new BusinessException(404, "NOT_FOUND", "没有找到这条动态");
        return Read(rows[0]);
    }
    public async Task<object> MarkRead(Actor actor, long id, bool all)
    {
        Admin(actor);
        await RequireInstalled();
        if (id < 1) throw BusinessException.Invalid("请选择有效动态");
        return await transactions.Run<object>(async (connection, transaction) =>
        {
            if ((await Database.Query(connection, transaction, "SELECT Id FROM StockNotifications WHERE Id=@id", ("id", id))).Count == 0)
                throw new BusinessException(404, "NOT_FOUND", "没有找到这条动态");
            await Database.Execute(connection, transaction,
                "INSERT IGNORE INTO StockNotificationReads(UserId,NotificationId,ReadAt) SELECT @user,Id,UTC_TIMESTAMP(6) FROM StockNotifications WHERE " + (all ? "Id<=@id" : "Id=@id"), [("user", actor.Id), ("id", id)]);
            return new { readThrough = all ? id : (long?)null, readId = all ? (long?)null : id };
        });
    }
    private async Task<object> SubscriptionStatus(MySqlConnection connection, MySqlTransaction? transaction, long userId)
    {
        var preferences = await Database.Query(connection, transaction, "SELECT Paused FROM WechatNotificationPreferences WHERE UserId=@user", ("user", userId));
        var bound = await Database.Query(connection, transaction, "SELECT AppId,OpenId FROM Users WHERE Id=@user", ("user", userId));
        var grants = await Database.Query(connection, transaction,
            "SELECT COUNT(*) AS Total FROM WechatNotificationGrants g JOIN Users u ON u.Id=g.UserId AND u.AppId=g.AppId AND u.OpenId=g.OpenId WHERE g.UserId=@user AND g.TemplateId=@template AND g.State='AVAILABLE'", ("user", userId), ("template", settings.TemplateId));
        var latest = await Database.Query(connection, transaction,
            "SELECT State,ErrorCode,CreatedAt FROM WechatNotificationDeliveries WHERE UserId=@user ORDER BY Id DESC LIMIT 1", ("user", userId));
        return new { configured = settings.Configured, templateId = settings.Configured ? settings.TemplateId : "", configurationError = settings.ConfigurationError,
            bound = !bound[0].IsNull("OpenId"), paused = preferences.Count > 0 && preferences[0].Flag("Paused"),
            recordedSubscriptions = grants[0].Id("Total"), lastDelivery = latest.FirstOrDefault()?.Output() };
    }
    public async Task<object> Subscribe(Actor actor, NotificationSubscriptionInput input, string key)
    {
        Admin(actor);
        await RequireInstalled();
        if (actor.SessionType != SessionTypes.Miniprogram) throw new BusinessException(403, "FORBIDDEN", "请在本人微信中订阅提醒");
        if (!settings.Configured) throw new BusinessException(503, "NOTIFICATION_NOT_CONFIGURED", "微信通知模板尚未配置，小程序内动态可正常查看");
        if (input.TemplateId != settings.TemplateId || input.Decision is not ("accept" or "reject" or "ban")) throw BusinessException.Invalid("微信订阅结果无效");
        return await transactions.Idempotent<object>(actor, "notification:subscribe", key, input, async (connection, transaction) =>
        {
            var users = await Database.Query(connection, transaction, "SELECT AppId,OpenId FROM Users WHERE Id=@user AND Enabled=TRUE FOR UPDATE", ("user", actor.Id));
            if (users.Count == 0 || users[0].IsNull("OpenId")) throw new BusinessException(403, "WECHAT_BINDING_REQUIRED", "请先绑定管理员本人微信");
            await Database.Execute(connection, transaction,
                "INSERT INTO WechatNotificationGrants(UserId,RequestKey,AppId,OpenId,TemplateId,Decision,State,CreatedAt) VALUES(@user,@key,@appid,@openid,@template,@decision,@state,UTC_TIMESTAMP(6))",
                [("user", actor.Id), ("key", key), ("appid", users[0].Text("AppId")), ("openid", users[0].Text("OpenId")),
                    ("template", input.TemplateId), ("decision", input.Decision), ("state", input.Decision == "accept" ? "AVAILABLE" : "DECLINED")]);
            if (input.Decision == "accept")
                await Database.Execute(connection, transaction, "INSERT INTO WechatNotificationPreferences VALUES(@user,FALSE) ON DUPLICATE KEY UPDATE Paused=FALSE", [("user", actor.Id)]);
            else if (input.Decision == "ban")
            {
                await Database.Execute(connection, transaction, "INSERT INTO WechatNotificationPreferences VALUES(@user,TRUE) ON DUPLICATE KEY UPDATE Paused=TRUE", [("user", actor.Id)]);
                await Database.Execute(connection, transaction, "UPDATE WechatNotificationGrants SET State='CANCELLED' WHERE UserId=@user AND State IN ('AVAILABLE','RESERVED')", [("user", actor.Id)]);
            }
            return new { recorded = true, decision = input.Decision };
        });
    }
    public async Task<object> Pause(Actor actor, bool paused)
    {
        Admin(actor);
        await RequireInstalled();
        return await transactions.Run<object>(async (connection, transaction) =>
        {
            await Database.Execute(connection, transaction, "INSERT INTO WechatNotificationPreferences VALUES(@user,@paused) ON DUPLICATE KEY UPDATE Paused=@paused", [("user", actor.Id), ("paused", paused)]);
            return new { paused };
        });
    }
}
