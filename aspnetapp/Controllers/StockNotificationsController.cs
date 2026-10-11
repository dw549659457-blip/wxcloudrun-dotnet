using aspnetapp.Domain;
using aspnetapp.Services;
using Microsoft.AspNetCore.Mvc;

namespace aspnetapp.Controllers;

[ApiController]
[Route("api/admin/stock-notifications")]
public sealed class StockNotificationsController(AuthService authentication, StockNotificationService notifications) : ApiController(authentication)
{
    [HttpGet]
    public async Task<object> Feed([FromQuery] long before = 0, [FromQuery] int limit = 20) => await notifications.Feed(await Current(), before, limit);
    [HttpGet("{id:long}")]
    public async Task<StockNotification> Detail(long id) => await notifications.Detail(await Current(), id);
    [HttpPost("read")]
    public async Task<object> ReadAll(NotificationReadInput input) => await notifications.MarkRead(await Current(), input.ThroughId, true);
    [HttpPost("{id:long}/read")]
    public async Task<object> Read(long id) => await notifications.MarkRead(await Current(), id, false);
    [HttpPost("subscribe")]
    public async Task<object> Subscribe(NotificationSubscriptionInput input) => await notifications.Subscribe(await Current(), input, Key);
    [HttpPost("preference")]
    public async Task<object> Preference(NotificationPauseInput input) => await notifications.Pause(await Current(), input.Paused);
}
