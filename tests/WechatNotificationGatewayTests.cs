using System.Net;
using System.Text;
using System.Text.Json;
using aspnetapp.Configuration;
using aspnetapp.Domain;
using aspnetapp.Integrations;
using aspnetapp.Services;
using Xunit;

namespace Business.Tests;

public sealed class WechatNotificationGatewayTests
{
    [Fact]
    public async Task User_template_74963_sends_actor_time_and_signed_stock_summary()
    {
        using var environment = new TemplateEnvironment(null, null);
        var settings = NotificationSettings.Load();
        Assert.True(settings.Configured);
        Assert.Equal("qYyaJOr5BwwRMldhCHEBqhefy7wIvcsNsibhxWA1vrw", settings.TemplateId);
        var notification = new StockNotification(7, 10, "OUTBOUND-10", DocumentKinds.Outbound, "POST", "发货出库", "调度员", "客户", "2026-10-11",
            new DateTime(2026, 10, 11, 8, 0, 0, DateTimeKind.Utc), [new(1, "白菜", "箱", InventoryDomains.Vegetable, -3, 8)], 1);
        var handler = new WechatHandler("{\"errcode\":0}", 200);
        var result = await Gateway(handler).Send(new("openid-test", settings.TemplateId, "pages/notification/index?id=7", settings.MiniprogramState,
            NotificationDeliveryService.TemplateData(notification, settings.Fields, "Asia/Shanghai")), CancellationToken.None);
        Assert.Equal(0, result.ErrorCode);
        var payload = handler.Messages.Single();
        Assert.Equal(settings.TemplateId, payload.GetProperty("template_id").GetString());
        var data = payload.GetProperty("data");
        Assert.Equal(3, data.EnumerateObject().Count());
        Assert.Equal("调度员", data.GetProperty("thing8").GetProperty("value").GetString());
        Assert.Equal("2026-10-11 16:00:00", data.GetProperty("time3").GetProperty("value").GetString());
        Assert.Equal("仓库-3箱 白菜", data.GetProperty("thing4").GetProperty("value").GetString());
    }
    [Theory]
    [InlineData("", "", false)]
    [InlineData("other-template", null, false)]
    [InlineData("other-template", "{\"thing2\":\"actor\"}", true)]
    [InlineData(null, "{\"time3\":\"actor\"}", false)]
    public void Explicit_overrides_can_disable_or_replace_template_without_reusing_wrong_fields(string? id, string? fields, bool configured)
    {
        using var environment = new TemplateEnvironment(id, fields);
        var settings = NotificationSettings.Load();
        Assert.Equal(configured, settings.Configured);
        if (id is not null) Assert.Equal(id, settings.TemplateId);
        if (configured) Assert.Equal("actor", settings.Fields["thing2"]);
    }
    private sealed class TemplateEnvironment : IDisposable
    {
        private readonly Dictionary<string, string?> saved = new[] { "WECHAT_NOTIFICATION_TEMPLATE_ID", "WECHAT_NOTIFICATION_FIELDS", "WECHAT_NOTIFICATION_STATE" }
            .ToDictionary(key => key, Environment.GetEnvironmentVariable);
        public TemplateEnvironment(string? id, string? fields)
        {
            Environment.SetEnvironmentVariable("WECHAT_NOTIFICATION_TEMPLATE_ID", id);
            Environment.SetEnvironmentVariable("WECHAT_NOTIFICATION_FIELDS", fields);
            Environment.SetEnvironmentVariable("WECHAT_NOTIFICATION_STATE", null);
        }
        public void Dispose()
        {
            foreach (var pair in saved) Environment.SetEnvironmentVariable(pair.Key, pair.Value);
        }
    }
    [Theory]
    [InlineData("{\"errcode\":0}", 200, 0, false)]
    [InlineData("{\"errcode\":43101}", 200, 43101, false)]
    [InlineData("bad response", 200, null, true)]
    [InlineData("unavailable", 503, null, true)]
    public async Task Subscribe_send_uses_standard_payload_and_classifies_unknown_responses(string body, int status, int? code, bool uncertain)
    {
        var handler = new WechatHandler(body, status);
        var gateway = Gateway(handler);
        var result = await gateway.Send(Message(), CancellationToken.None);
        Assert.Equal(code, result.ErrorCode); Assert.Equal(uncertain, result.Uncertain);
        var payload = handler.Messages.Single();
        Assert.Equal("openid-test", payload.GetProperty("touser").GetString());
        Assert.Equal("template-test", payload.GetProperty("template_id").GetString());
        Assert.Equal("trial", payload.GetProperty("miniprogram_state").GetString());
        Assert.Equal("pages/notification/index?id=1", payload.GetProperty("page").GetString());
        Assert.Equal("发货出库", payload.GetProperty("data").GetProperty("thing1").GetProperty("value").GetString());
    }
    [Fact]
    public async Task Expired_token_is_refetched_once_before_retrying_send()
    {
        var handler = new WechatHandler("{\"errcode\":0}", 200) { ExpireFirstToken = true };
        var result = await Gateway(handler).Send(Message(), CancellationToken.None);
        Assert.Equal(0, result.ErrorCode); Assert.Equal(2, handler.Tokens); Assert.Equal(2, handler.Messages.Count);
    }
    private static WechatNotificationMessage Message() => new("openid-test", "template-test", "pages/notification/index?id=1", "trial", new() { ["thing1"] = new { value = "发货出库" } });
    private static WechatGateway Gateway(WechatHandler handler) => new(new AppSettings("not-used", 80, false, false, "Asia/Shanghai", 30, "appid-test", "not-used-secret", "standard", []), new ClientFactory(handler));
    private sealed class ClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, false);
    }
    private sealed class WechatHandler(string body, int status) : HttpMessageHandler
    {
        public int Tokens { get; private set; }
        public bool ExpireFirstToken { get; init; }
        public List<JsonElement> Messages { get; } = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("stable_token", StringComparison.Ordinal))
            {
                Tokens++;
                return new(HttpStatusCode.OK) { Content = new StringContent("{\"access_token\":\"fake-token\",\"expires_in\":7200}", Encoding.UTF8, "application/json") };
            }
            Assert.EndsWith("/message/subscribe/send", request.RequestUri.AbsolutePath);
            using var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            Messages.Add(json.RootElement.Clone());
            return new((HttpStatusCode)status) { Content = new StringContent(ExpireFirstToken && Messages.Count == 1 ? "{\"errcode\":42001}" : body, Encoding.UTF8, "application/json") };
        }
    }
}
