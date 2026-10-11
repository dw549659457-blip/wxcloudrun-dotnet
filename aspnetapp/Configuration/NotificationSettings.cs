using System.Text.Json;
using System.Text.RegularExpressions;

namespace aspnetapp.Configuration;

public sealed record NotificationSettings(string TemplateId, Dictionary<string, string> Fields, string MiniprogramState = "trial", string ConfigurationError = "")
{
    // 用户提供的小程序公开模板74963：库存更新提醒。环境变量可覆盖；显式空值可停用。
    public const string DefaultTemplateId = "qYyaJOr5BwwRMldhCHEBqhefy7wIvcsNsibhxWA1vrw";
    public const string DefaultFieldsJson = "{\"thing8\":\"actor\",\"time3\":\"time\",\"thing4\":\"summary\"}";
    public bool Configured => TemplateId.Length > 0 && Fields.Count > 0 && ConfigurationError.Length == 0;
    public static NotificationSettings Load()
    {
        var id = Environment.GetEnvironmentVariable("WECHAT_NOTIFICATION_TEMPLATE_ID") ?? DefaultTemplateId;
        var json = Environment.GetEnvironmentVariable("WECHAT_NOTIFICATION_FIELDS") ?? (id == DefaultTemplateId ? DefaultFieldsJson : "");
        var state = Environment.GetEnvironmentVariable("WECHAT_NOTIFICATION_STATE") ?? "trial";
        if (id.Length == 0 && json.Length == 0) return new("", [], state);
        try
        {
            var fields = JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? [];
            string[] sources = ["event", "summary", "actor", "time", "number", "item", "quantity", "unit", "party"];
            if (id.Length is < 1 or > 128 || !Regex.IsMatch(id, "^[A-Za-z0-9_-]+$") || fields.Count is < 1 or > 10
                || state is not ("developer" or "trial" or "formal")
                || fields.Any(pair => !Regex.IsMatch(pair.Key, "^(thing|time|character_string|phrase|name|number)[1-9][0-9]*$")
                    || !sources.Contains(pair.Value)
                    || pair.Key.StartsWith("time", StringComparison.Ordinal) != (pair.Value == "time")
                    || (pair.Key.StartsWith("number", StringComparison.Ordinal) && pair.Value != "quantity")))
                return new(id, [], state, "微信通知配置有误，请核对模板ID、字段映射与 WECHAT_NOTIFICATION_STATE");
            return new(id, fields, state);
        }
        catch (JsonException)
        {
            return new(id, [], state, "微信通知模板字段需填写有效的 JSON 对象");
        }
    }
}
