using System.Text.Json;
using aspnetapp.Configuration;
using aspnetapp.Domain;

namespace aspnetapp.Integrations;

public interface IWechatGateway
{
    Task<(string AppId, string OpenId)> Identity(string code);
    Task<string> Phone(string code);
}

/// <summary>不采信公网 x-wx-* 头；登录 code 和手机号 code 分别向微信换取真实信息。</summary>
public sealed class WechatGateway(AppSettings settings, IHttpClientFactory clients) : IWechatGateway
{
    private readonly SemaphoreSlim tokenGate = new(1, 1);
    private string? accessToken;
    private DateTime expiresAt;
    private void CheckConfiguration()
    {
        if (string.IsNullOrEmpty(settings.AppId) || string.IsNullOrEmpty(settings.AppSecret))
        {
            throw new BusinessException(503, "WECHAT_NOT_CONFIGURED", "微信登录暂未配置，请联系管理员");
        }
    }
    private static void Check(JsonElement response)
    {
        if (response.TryGetProperty("errcode", out var error) && error.GetInt32() != 0)
        {
            throw new BusinessException(502, "WECHAT_REQUEST_FAILED", "微信验证未成功，请重新进入或联系管理员");
        }
    }
    public async Task<(string AppId, string OpenId)> Identity(string code)
    {
        CheckConfiguration();
        if (string.IsNullOrWhiteSpace(code) || code.Length > 512)
        {
            throw BusinessException.Invalid("缺少微信登录凭证");
        }

        var url = $"https://api.weixin.qq.com/sns/jscode2session?appid={Uri.EscapeDataString(settings.AppId!)}&secret={Uri.EscapeDataString(settings.AppSecret!)}&js_code={Uri.EscapeDataString(code)}&grant_type=authorization_code";
        using var response = await clients.CreateClient("wechat").GetAsync(url);
        if (!response.IsSuccessStatusCode)
        {
            throw new BusinessException(502, "WECHAT_UNAVAILABLE", "微信暂时无法连接，请稍后重试");
        }

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Check(json.RootElement);
        return (settings.AppId!, json.RootElement.GetProperty("openid").GetString()!);
    }
    private async Task<string> Token()
    {
        CheckConfiguration();
        await tokenGate.WaitAsync();
        try
        {
            if (accessToken is not null && DateTime.UtcNow < expiresAt)
            {
                return accessToken;
            }

            // stable_token 的 force_refresh=false 避免多个应用副本重复获取令牌使彼此缓存失效。
            using var response = await clients.CreateClient("wechat").PostAsJsonAsync("https://api.weixin.qq.com/cgi-bin/stable_token", new { grant_type = "client_credential", appid = settings.AppId, secret = settings.AppSecret, force_refresh = false });
            if (!response.IsSuccessStatusCode)
            {
                throw new BusinessException(502, "WECHAT_UNAVAILABLE", "微信暂时无法连接");
            }

            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Check(json.RootElement);
            accessToken = json.RootElement.GetProperty("access_token").GetString()!;
            expiresAt = DateTime.UtcNow.AddSeconds(Math.Max(60, json.RootElement.GetProperty("expires_in").GetInt32() - 120));
            return accessToken;
        }
        finally { tokenGate.Release(); }
    }
    public async Task<string> Phone(string code)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length > 512)
        {
            throw BusinessException.Invalid("缺少微信手机号授权凭证");
        }

        var token = await Token();
        var client = clients.CreateClient("wechat");
        using var response = await client.PostAsJsonAsync($"https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token={Uri.EscapeDataString(token)}", new { code });
        if (!response.IsSuccessStatusCode)
        {
            throw new BusinessException(502, "WECHAT_UNAVAILABLE", "手机号验证暂时不可用，可以请管理员帮助开通");
        }

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Check(json.RootElement);
        return json.RootElement.GetProperty("phone_info").GetProperty("purePhoneNumber").GetString()!;
    }
}
