using System.Globalization;
using System.Text;
using aspnetapp.Configuration;
using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using aspnetapp.Integrations;

namespace aspnetapp.Services;

public sealed class NotificationDeliveryService(TransactionService transactions, IWechatNotifier wechat, AppSettings appSettings, StockNotificationService notifications)
{
    private sealed record Delivery(long Id, long GrantId, string Lease, int Attempts, WechatNotificationMessage Message);
    private static string Short(string text, int length) => string.Concat(text.EnumerateRunes().Take(length).Select(rune => rune.ToString()));
    public static Dictionary<string, object> TemplateData(StockNotification notification, Dictionary<string, string> fields, string timeZone)
    {
        var line = notification.Lines.FirstOrDefault(item => item.Domain is InventoryDomains.Vegetable or "OUTPUT")
            ?? notification.Lines.FirstOrDefault(item => item.Domain == InventoryDomains.WarehousePackaging) ?? notification.Lines.FirstOrDefault();
        var domain = line?.Domain switch { "OUTPUT" => "产出", InventoryDomains.ExternalPackaging => "在外", _ => "仓库" };
        var quantity = line is null ? "" : domain + line.Delta.ToString("+0.###;-0.###;0", CultureInfo.InvariantCulture) + line.Unit;
        var summary = quantity.Length > 20 ? "数量详见本次变动明细" : quantity + " " + (line?.Name ?? notification.Title) + (notification.LineCount > 1 ? "等" : "");
        var values = new Dictionary<string, string>
        {
            ["event"] = notification.Action == "REVERSE" ? "单据冲销" : notification.Title,
            ["actor"] = notification.Actor, ["number"] = notification.Number, ["party"] = notification.Party.Length == 0 ? "仓库" : notification.Party,
            ["item"] = line?.Name ?? "库存记录", ["quantity"] = Math.Abs(line?.Delta ?? 0).ToString("0.###", CultureInfo.InvariantCulture),
            ["unit"] = line?.Unit ?? "", ["summary"] = summary,
            ["time"] = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(notification.OccurredAt, DateTimeKind.Utc), TimeZoneInfo.FindSystemTimeZoneById(timeZone)).ToString("yyyy-MM-dd HH:mm:ss")
        };
        return fields.ToDictionary(pair => pair.Key, pair => (object)new
        {
            value = pair.Key.StartsWith("time", StringComparison.Ordinal) ? values[pair.Value] :
                Short(values[pair.Value], pair.Key.StartsWith("phrase", StringComparison.Ordinal) ? 5 :
                    pair.Key.StartsWith("name", StringComparison.Ordinal) ? 10 : pair.Key.StartsWith("character_string", StringComparison.Ordinal) ? 32 : 20)
        });
    }
    public async Task<bool> ProcessNext(CancellationToken cancellation = default)
    {
        if (!await notifications.Installed()) return false;
        var claimed = await transactions.Run<Delivery?>(async (connection, transaction) =>
        {
            // 崩溃可能发生在微信接收后、结果落库前；过期租约标为不确定，避免重复微信提醒。
            await Database.Execute(connection, transaction,
                "UPDATE WechatNotificationGrants g JOIN WechatNotificationDeliveries d ON d.GrantId=g.Id SET g.State='CONSUMED' WHERE d.State='SENDING' AND d.LeaseUntil<UTC_TIMESTAMP(6)");
            await Database.Execute(connection, transaction,
                "UPDATE WechatNotificationDeliveries SET State='UNCERTAIN',FinishedAt=UTC_TIMESTAMP(6) WHERE State='SENDING' AND LeaseUntil<UTC_TIMESTAMP(6)");
            var rows = await Database.Query(connection, transaction,
                "SELECT d.*,g.AppId,g.OpenId,g.State AS GrantState,u.AppId AS CurrentAppId,u.OpenId AS CurrentOpenId,u.Enabled," +
                "COALESCE(p.Paused,FALSE) AS Paused,EXISTS(SELECT 1 FROM UserRoles r WHERE r.UserId=u.Id AND r.Role='ADMIN') AS IsAdmin,n.Payload " +
                "FROM WechatNotificationDeliveries d JOIN WechatNotificationGrants g ON g.Id=d.GrantId JOIN Users u ON u.Id=d.UserId " +
                "JOIN StockNotifications n ON n.Id=d.NotificationId LEFT JOIN WechatNotificationPreferences p ON p.UserId=u.Id " +
                "WHERE d.State='PENDING' AND d.NextAttemptAt<=UTC_TIMESTAMP(6) ORDER BY d.Id LIMIT 1 FOR UPDATE");
            if (rows.Count == 0) return null;
            var row = rows[0];
            if (row.Text("GrantState") != "RESERVED" || !row.Flag("Enabled") || !row.Flag("IsAdmin") || row.Flag("Paused") || row.IsNull("CurrentOpenId")
                || row.Text("OpenId") != row.Text("CurrentOpenId") || row.Text("AppId") != row.Text("CurrentAppId") || row.Text("AppId") != appSettings.AppId)
            {
                await Database.Execute(connection, transaction, "UPDATE WechatNotificationDeliveries SET State='CANCELLED',FinishedAt=UTC_TIMESTAMP(6) WHERE Id=@id", [("id", row.Id("Id"))]);
                await Database.Execute(connection, transaction, "UPDATE WechatNotificationGrants SET State=@state WHERE Id=@id",
                    [("id", row.Id("GrantId")), ("state", row.Text("GrantState") == "RESERVED" && row.Flag("Paused") && row.Flag("Enabled") && row.Flag("IsAdmin")
                        && row.Text("OpenId") == row.Text("CurrentOpenId") && row.Text("AppId") == row.Text("CurrentAppId") && row.Text("AppId") == appSettings.AppId ? "AVAILABLE" : "CANCELLED")]);
                return null;
            }
            var lease = PasswordService.Token();
            await Database.Execute(connection, transaction,
                "UPDATE WechatNotificationDeliveries SET State='SENDING',Attempts=Attempts+1,LeaseToken=@lease,LeaseUntil=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 90 SECOND) WHERE Id=@id",
                [("id", row.Id("Id")), ("lease", lease)]);
            var notification = JsonSettings.Deserialize<StockNotification>(row.Text("Payload")) with { Id = row.Id("NotificationId") };
            var fields = JsonSettings.Deserialize<Dictionary<string, string>>(row.Text("Fields"));
            return new(row.Id("Id"), row.Id("GrantId"), lease, (int)row.Id("Attempts") + 1,
                new(row.Text("OpenId"), row.Text("TemplateId"), $"pages/notification/index?id={notification.Id}", row.Text("MiniprogramState"), TemplateData(notification, fields, appSettings.TimeZone)));
        });
        if (claimed is null) return false;
        WechatDeliveryResult result;
        try { result = await wechat.Send(claimed.Message, cancellation); }
        catch (BusinessException) { result = new(null); }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException) { result = new(null, Uncertain: true); }
        await transactions.Run(async (connection, transaction) =>
        {
            var retry = result.Retryable && !result.Uncertain && claimed.Attempts < 5;
            var state = retry ? "PENDING" : result.Uncertain ? "UNCERTAIN" : result.ErrorCode == 0 ? "SENT" : "FAILED";
            var changed = await Database.Execute(connection, transaction,
                "UPDATE WechatNotificationDeliveries SET State=@state,ErrorCode=@code,NextAttemptAt=@next,FinishedAt=@finished,LeaseUntil=NULL WHERE Id=@id AND State='SENDING' AND LeaseToken=@lease",
                [("state", state), ("code", result.ErrorCode), ("next", DateTime.UtcNow.AddSeconds(Math.Min(300, 5 * Math.Pow(2, claimed.Attempts)))),
                    ("finished", retry ? null : (DateTime?)DateTime.UtcNow), ("id", claimed.Id), ("lease", claimed.Lease)]);
            if (changed == 1 && !retry)
                await Database.Execute(connection, transaction, "UPDATE WechatNotificationGrants SET State='CONSUMED' WHERE Id=@id", [("id", claimed.GrantId)]);
            return true;
        });
        return true;
    }
}
