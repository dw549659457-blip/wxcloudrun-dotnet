namespace aspnetapp.Integrations;

public sealed record WechatNotificationMessage(string OpenId, string TemplateId, string Page,
    string MiniprogramState, Dictionary<string, object> Data);
public sealed record WechatDeliveryResult(int? ErrorCode, bool Uncertain = false, bool Retryable = false);
public interface IWechatNotifier
{
    Task<WechatDeliveryResult> Send(WechatNotificationMessage message, CancellationToken cancellation);
}
