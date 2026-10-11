using System.Collections.Concurrent;
using System.Net;
using aspnetapp.Configuration;
using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using aspnetapp.Integrations;
using aspnetapp.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Xunit;
using static Business.Tests.TestFixture;

namespace Business.Tests;

public sealed class NotificationTests(TestFixture fixture) : IClassFixture<TestFixture>, IAsyncLifetime
{
    private WebApplicationFactory<Program> factory = null!;
    private readonly FakeNotifier notifier = new();
    private readonly Dictionary<string, HttpClient> clients = [];
    public async Task InitializeAsync()
    {
        await using var connection = await fixture.Database.Open();
        await Database.Execute(connection, null, "UPDATE WechatNotificationDeliveries SET State='CANCELLED' WHERE State IN ('PENDING','SENDING')");
        await Database.Execute(connection, null, "UPDATE WechatNotificationGrants SET State='CANCELLED' WHERE State IN ('AVAILABLE','RESERVED')");
        await Database.Execute(connection, null, "UPDATE Users SET AppId='test-app',OpenId=@openid WHERE Username='admin'", [("openid", "admin-" + Guid.NewGuid().ToString("N"))]);
        await Database.Execute(connection, null, "DELETE FROM WechatNotificationPreferences");
        factory = fixture.Factory.WithWebHostBuilder(host => host.ConfigureServices(services =>
        {
            var app = AppSettings.Load() with { AppId = "test-app", AppSecret = "not-used-test-secret" };
            services.RemoveAll<AppSettings>(); services.AddSingleton(app);
            services.RemoveAll<NotificationSettings>();
            services.AddSingleton(new NotificationSettings("test-template", new() { ["thing1"] = "event", ["thing2"] = "summary", ["time3"] = "time" }));
            services.RemoveAll<IWechatNotifier>(); services.AddSingleton<IWechatNotifier>(notifier);
            foreach (var registration in services.Where(item => item.ServiceType == typeof(IHostedService) && item.ImplementationType == typeof(NotificationWorker)).ToArray())
                services.Remove(registration);
        }));
        foreach (var name in new[] { "admin", "driver1", "worker1", "outbound1" })
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Authorization = fixture.Clients[name].DefaultRequestHeaders.Authorization;
            clients.Add(name, client);
        }
    }
    public async Task DisposeAsync()
    {
        foreach (var client in clients.Values) client.Dispose();
        await factory.DisposeAsync();
    }
    private async Task<long> Post(string user, string resource, DocumentInput input, string? key = null, bool post = true)
    {
        var response = await Send(clients[user], HttpMethod.Post, "/api/" + resource, new DraftInput(input, post), key);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await Json(response)).GetProperty("id").GetInt64();
    }
    private async Task Subscribe(string? key = null, string decision = "accept")
    {
        (await Send(clients["admin"], HttpMethod.Post, "/api/admin/stock-notifications/subscribe", new NotificationSubscriptionInput("test-template", decision), key)).EnsureSuccessStatusCode();
    }
    private async Task<HttpClient> AdditionalUser(string role)
    {
        var username = "notify-" + Guid.NewGuid().ToString("N");
        const string password = "Notification-test-password-2026";
        (await Send(clients["admin"], HttpMethod.Post, "/api/users", new UserInput(username, "后台测试", "138" + Random.Shared.Next(10000000, 99999999), [role], Password: password))).EnsureSuccessStatusCode();
        var client = factory.CreateClient();
        var login = await Json(await Send(client, HttpMethod.Post, "/api/auth/dev-login", new LoginInput(username, password)));
        client.DefaultRequestHeaders.Authorization = new("Bearer", login.GetProperty("token").GetString());
        return client;
    }
    private async Task<long> Count(string table, string where = "1=1")
    {
        await using var connection = await fixture.Database.Open();
        return (await Database.Query(connection, null, $"SELECT COUNT(*) AS Total FROM {table} WHERE {where}"))[0].Id("Total");
    }
    private async Task<List<Row>> Deliveries()
    {
        await using var connection = await fixture.Database.Open();
        return await Database.Query(connection, null, "SELECT * FROM WechatNotificationDeliveries ORDER BY Id DESC");
    }
    [Fact]
    public async Task Code_before_database_upgrade_preserves_posting_and_enables_feed_after_upgrade()
    {
        var (_, vegetable) = await fixture.Stock(0, 10);
        await using var connection = await fixture.Database.Open();
        var migration = (await Database.Query(connection, null, "SELECT * FROM SchemaMigrations WHERE Name='006_stock_notifications.sql'"))[0];
        await Database.Execute(connection, null, "DELETE FROM SchemaMigrations WHERE Name='006_stock_notifications.sql'");
        try
        {
            var before = await Count("StockNotifications");
            await Post("outbound1", "outbounds", new(new(2026, 10, 11), [new(vegetable, 1)], CustomerId: fixture.Customer));
            Assert.Equal(9, await fixture.Balance(vegetable)); Assert.Equal(before, await Count("StockNotifications"));
            var response = await clients["admin"].GetAsync("/api/admin/stock-notifications");
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            Assert.Equal("NOTIFICATIONS_NOT_READY", (await Json(response)).GetProperty("code").GetString());
        }
        finally
        {
            await Database.Execute(connection, null, "INSERT INTO SchemaMigrations VALUES(@name,@checksum,@at)", [("name", migration.Text("Name")), ("checksum", migration.Text("Checksum")), ("at", migration.DateTime("AppliedAt"))]);
        }
        (await clients["admin"].GetAsync("/api/admin/stock-notifications")).EnsureSuccessStatusCode();
        await Post("outbound1", "outbounds", new(new(2026, 10, 11), [new(vegetable, 1)], CustomerId: fixture.Customer));
        Assert.Equal(8, await fixture.Balance(vegetable));
    }
    [Fact]
    public async Task Draft_failed_post_and_duplicate_idempotent_post_do_not_create_extra_notifications()
    {
        var (_, vegetable) = await fixture.Stock(0, 5);
        var input = new DocumentInput(new(2026, 10, 11), [new(vegetable, 1)], CustomerId: fixture.Customer);
        var draft = await Post("outbound1", "outbounds", input, post: false);
        Assert.Equal(0, await Count("StockNotifications", $"DocumentId={draft}"));
        var failed = await Send(clients["outbound1"], HttpMethod.Post, "/api/outbounds", new DraftInput(input with { Items = [new(vegetable, 100)] }, true));
        Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode);
        var before = await Count("StockNotifications");
        var key = Guid.NewGuid().ToString("N");
        var ids = await Task.WhenAll(Post("outbound1", "outbounds", input, key), Post("outbound1", "outbounds", input, key));
        Assert.Equal(ids[0], ids[1]);
        Assert.Equal(before + 1, await Count("StockNotifications"));
        Assert.Equal(4, await fixture.Balance(vegetable));
    }
    [Fact]
    public async Task Work_recovery_and_both_outbound_modes_preserve_distinct_stock_meaning()
    {
        var (packaging, vegetable) = await fixture.Stock();
        var batch = await fixture.Dispatch(packaging);
        var work = await Post("worker1", "work-records", new(new(2026, 10, 11), [new(packaging, 70)], BatchId: batch, Vegetables: [new(vegetable, 12)]));
        var recovered = await Post("driver1", "recoveries", new(new(2026, 10, 11), [new(packaging, 25)], BatchId: batch, Vegetables: [new(vegetable, 12)], Mode: "FINAL", ConfirmFinal: true, LossReason: "损坏"));
        var outbound = await Post("outbound1", "outbounds", new(new(2026, 10, 11), [new(vegetable, 3)], CustomerId: fixture.Customer));
        var direct = await Post("outbound1", "outbounds", new(new(2026, 10, 11), [new(vegetable, 1)], CustomerId: fixture.Customer, Mode: "DIRECT", Remark: "现场装车"));
        var feed = await Json(await clients["admin"].GetAsync("/api/admin/stock-notifications"));
        var rows = feed.GetProperty("items").EnumerateArray().Select(row => row.GetProperty("notification")).ToArray();
        var workEvent = rows.Single(row => row.GetProperty("documentId").GetInt64() == work);
        var output = workEvent.GetProperty("lines").EnumerateArray().Single(row => row.GetProperty("domain").GetString() == "OUTPUT");
        Assert.Equal(12m, decimal.Parse(output.GetProperty("delta").GetString()!, System.Globalization.CultureInfo.InvariantCulture)); Assert.Equal(System.Text.Json.JsonValueKind.Null, output.GetProperty("balance").ValueKind);
        var recovery = rows.Single(row => row.GetProperty("documentId").GetInt64() == recovered);
        Assert.Equal("回收入库", recovery.GetProperty("title").GetString());
        foreach (var id in new[] { outbound, direct }) Assert.Equal("发货出库", rows.Single(row => row.GetProperty("documentId").GetInt64() == id).GetProperty("title").GetString());
        Assert.Equal(925, await fixture.Balance(packaging)); Assert.Equal(8, await fixture.Balance(vegetable));
        var body = feed.ToString(); Assert.DoesNotContain("openId", body, StringComparison.OrdinalIgnoreCase); Assert.DoesNotContain("password", body, StringComparison.OrdinalIgnoreCase);
    }
    [Fact]
    public async Task Reversal_creates_one_inverse_event_and_failed_correction_rolls_back_events()
    {
        var (_, vegetable) = await fixture.Stock(0, 10);
        var input = new DocumentInput(new(2026, 10, 11), [new(vegetable, 2)], CustomerId: fixture.Customer);
        var id = await Post("outbound1", "outbounds", input);
        var count = await Count("StockNotifications");
        var failed = await Send(clients["admin"], HttpMethod.Post, $"/api/admin/documents/outbounds/{id}/correct", new CorrectInput("修正", input with { Items = [new(vegetable, 100)] }));
        Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode); Assert.Equal(count, await Count("StockNotifications")); Assert.Equal(8, await fixture.Balance(vegetable));
        var key = Guid.NewGuid().ToString("N");
        for (var attempt = 0; attempt < 2; attempt++)
            (await Send(clients["admin"], HttpMethod.Post, $"/api/admin/documents/outbounds/{id}/reverse", new ReverseInput("撤销装车"), key)).EnsureSuccessStatusCode();
        Assert.Equal(1, await Count("StockNotifications", $"DocumentId={id} AND Action='REVERSE'")); Assert.Equal(10, await fixture.Balance(vegetable));
    }
    [Fact]
    public async Task Read_states_are_personal_and_bulk_read_does_not_consume_future_events()
    {
        var (_, vegetable) = await fixture.Stock(0, 10);
        var feed = await Json(await clients["admin"].GetAsync("/api/admin/stock-notifications?limit=1"));
        var latest = feed.GetProperty("latestId").GetInt64();
        (await Send(clients["admin"], HttpMethod.Post, "/api/admin/stock-notifications/read", new NotificationReadInput(latest))).EnsureSuccessStatusCode();
        var id = await Post("outbound1", "outbounds", new(new(2026, 10, 11), [new(vegetable, 1)], CustomerId: fixture.Customer));
        var updated = await Json(await clients["admin"].GetAsync("/api/admin/stock-notifications?limit=1"));
        Assert.Equal(1, updated.GetProperty("unreadCount").GetInt64());
        var eventId = updated.GetProperty("items")[0].GetProperty("notification").GetProperty("id").GetInt64();
        (await Send(clients["admin"], HttpMethod.Post, $"/api/admin/stock-notifications/{eventId}/read")).EnsureSuccessStatusCode();
        Assert.Equal(0, (await Json(await clients["admin"].GetAsync("/api/admin/stock-notifications"))).GetProperty("unreadCount").GetInt64());
        Assert.Equal(HttpStatusCode.Forbidden, (await clients["worker1"].GetAsync("/api/admin/stock-notifications")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clients["worker1"].GetAsync($"/api/admin/stock-notifications/{eventId}")).StatusCode);
        using var anonymous = factory.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/admin/stock-notifications")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await clients["admin"].GetAsync("/api/admin/stock-notifications?limit=100")).StatusCode);
        using var otherAdmin = await AdditionalUser(Roles.Admin);
        Assert.True((await Json(await otherAdmin.GetAsync("/api/admin/stock-notifications"))).GetProperty("unreadCount").GetInt64() > 0);
        using var accountant = await AdditionalUser(Roles.Accountant);
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.GetAsync("/api/admin/stock-notifications")).StatusCode);
        Assert.True(await Count("BackOfficeOperationLogs", "Path='/api/admin/stock-notifications' AND Module='stock-notifications'") > 0);
    }
    [Fact]
    public async Task Subscription_retry_records_one_grant_and_denial_creates_none()
    {
        var before = await Count("WechatNotificationGrants", "State='AVAILABLE'");
        var key = Guid.NewGuid().ToString("N"); await Subscribe(key); await Subscribe(key);
        Assert.Equal(before + 1, await Count("WechatNotificationGrants", "State='AVAILABLE'"));
        await Subscribe(decision: "reject"); Assert.Equal(before + 1, await Count("WechatNotificationGrants", "State='AVAILABLE'"));
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(clients["worker1"], HttpMethod.Post, "/api/admin/stock-notifications/subscribe", new NotificationSubscriptionInput("test-template", "accept"))).StatusCode);
    }
    [Fact]
    public async Task One_subscription_is_reserved_for_one_event_and_multiple_workers_send_once()
    {
        var (_, vegetable) = await fixture.Stock(0, 10);
        await Subscribe();
        var input = new DocumentInput(new(2026, 10, 11), [new(vegetable, 1)], CustomerId: fixture.Customer);
        await Post("outbound1", "outbounds", input); await Post("outbound1", "outbounds", input);
        var delivery = (await Deliveries())[0];
        var service = factory.Services.GetRequiredService<NotificationDeliveryService>();
        await Task.WhenAll(service.ProcessNext(), service.ProcessNext());
        Assert.Single(notifier.Messages); Assert.Equal("SENT", (await Deliveries()).Single(row => row.Id("Id") == delivery.Id("Id")).Text("State"));
        Assert.StartsWith("pages/notification/index?id=", notifier.Messages.Single().Page);
        Assert.Equal("trial", notifier.Messages.Single().MiniprogramState); Assert.Equal(8, await fixture.Balance(vegetable));
    }
    [Theory]
    [InlineData("paused")]
    [InlineData("role")]
    [InlineData("binding")]
    public async Task Pending_delivery_rechecks_preference_admin_role_and_current_binding(string change)
    {
        var (_, vegetable) = await fixture.Stock(0, 10); await Subscribe();
        await Post("outbound1", "outbounds", new(new(2026, 10, 11), [new(vegetable, 1)], CustomerId: fixture.Customer));
        await using var connection = await fixture.Database.Open();
        var user = (await Database.Query(connection, null, "SELECT Id FROM Users WHERE Username='admin'"))[0].Id("Id");
        if (change == "paused") (await Send(clients["admin"], HttpMethod.Post, "/api/admin/stock-notifications/preference", new NotificationPauseInput(true))).EnsureSuccessStatusCode();
        else if (change == "role") await Database.Execute(connection, null, "DELETE FROM UserRoles WHERE UserId=@id AND Role='ADMIN'", [("id", user)]);
        else await Database.Execute(connection, null, "UPDATE Users SET OpenId=NULL,AppId=NULL WHERE Id=@id", [("id", user)]);
        try
        {
            await factory.Services.GetRequiredService<NotificationDeliveryService>().ProcessNext();
            Assert.Empty(notifier.Messages); Assert.Equal("CANCELLED", (await Deliveries())[0].Text("State"));
        }
        finally { if (change == "role") await Database.Execute(connection, null, "INSERT INTO UserRoles VALUES(@id,'ADMIN')", [("id", user)]); }
    }
    [Theory]
    [InlineData(-1, "PENDING")]
    [InlineData(43101, "FAILED")]
    [InlineData(0, "UNCERTAIN")]
    public async Task Known_busy_retries_but_denied_or_uncertain_send_is_not_blindly_repeated(int code, string expected)
    {
        var (_, vegetable) = await fixture.Stock(0, 10); await Subscribe();
        await Post("outbound1", "outbounds", new(new(2026, 10, 11), [new(vegetable, 1)], CustomerId: fixture.Customer));
        notifier.Results.Enqueue(new(code, Uncertain: expected == "UNCERTAIN", Retryable: code == -1));
        var service = factory.Services.GetRequiredService<NotificationDeliveryService>(); await service.ProcessNext();
        Assert.Equal(expected, (await Deliveries())[0].Text("State"));
        await using var connection = await fixture.Database.Open();
        await Database.Execute(connection, null, "UPDATE WechatNotificationDeliveries SET NextAttemptAt=UTC_TIMESTAMP(6)");
        await service.ProcessNext();
        Assert.Equal(expected == "PENDING" ? 2 : 1, notifier.Messages.Count);
        Assert.Equal(expected == "PENDING" ? "SENT" : expected, (await Deliveries())[0].Text("State"));
        Assert.Equal(9, await fixture.Balance(vegetable));
    }
    [Fact]
    public async Task Expired_sending_lease_is_uncertain_and_not_replayed_after_restart()
    {
        var (_, vegetable) = await fixture.Stock(0, 10); await Subscribe();
        await Post("outbound1", "outbounds", new(new(2026, 10, 11), [new(vegetable, 1)], CustomerId: fixture.Customer));
        await using var connection = await fixture.Database.Open();
        await Database.Execute(connection, null, "UPDATE WechatNotificationDeliveries SET State='SENDING',LeaseUntil=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE State='PENDING'");
        await factory.Services.GetRequiredService<NotificationDeliveryService>().ProcessNext();
        Assert.Empty(notifier.Messages); Assert.Equal("UNCERTAIN", (await Deliveries())[0].Text("State"));
    }
}

public sealed class FakeNotifier : IWechatNotifier
{
    public ConcurrentQueue<WechatDeliveryResult> Results { get; } = new();
    public ConcurrentBag<WechatNotificationMessage> Messages { get; } = new();
    public Task<WechatDeliveryResult> Send(WechatNotificationMessage message, CancellationToken cancellation)
    {
        Messages.Add(message);
        return Task.FromResult(Results.TryDequeue(out var result) ? result : new(0));
    }
}
