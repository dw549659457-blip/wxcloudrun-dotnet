using System.Net;
using System.Text;
using System.Text.Json;
using aspnetapp.Configuration;
using aspnetapp.Integrations;
using Xunit;

namespace Business.Tests;

public sealed class WechatNotificationGatewayTests
{
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
