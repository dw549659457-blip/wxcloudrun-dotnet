using aspnetapp.Configuration;

namespace aspnetapp.Services;

public sealed class NotificationWorker(NotificationDeliveryService deliveries, NotificationSettings settings, ILogger<NotificationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!settings.Configured) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await deliveries.ProcessNext(stoppingToken)) continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error)
            {
                // 不输出微信凭证、URL、openid或异常内容；动态和库存事务已独立落库。
                logger.LogWarning("Notification delivery queue temporarily unavailable: {Type}", error.GetType().Name);
            }
            try { await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
