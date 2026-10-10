using Microsoft.AspNetCore.Mvc;
using aspnetapp.Domain;
using aspnetapp.Services;
using aspnetapp.Configuration;
using aspnetapp.Repositories;

namespace aspnetapp.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController(AuthService authentication, AppSettings settings, QueryRepository queries) : ApiController(authentication)
{
    [HttpPost("admin-login")]
    public async Task<object> AdminLogin(LoginInput input)
    {
        var session = await Authentication.Login(input, HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown", false);
        Response.Cookies.Append("warehouse_session", session.Token, new CookieOptions { HttpOnly = true, Secure = settings.Production, SameSite = SameSiteMode.Strict, Path = "/", MaxAge = TimeSpan.FromHours(8) });
        return new { session.UserId, session.Name, session.Roles, session.CsrfToken };
    }
    [HttpPost("dev-login")]
    public Task<SessionResult> DevelopmentLogin(LoginInput input) => Authentication.Login(input, HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown", true);
    [HttpPost("wechat-login")]
    public Task<object> WechatLogin(WechatLoginInput input) => Authentication.WechatLogin(input.Code);
    [HttpPost("bind-phone")]
    public Task<object> BindPhone(PhoneBindingInput input) => Authentication.BindPhone(input);
    [HttpPost("confirm-binding")]
    public Task<SessionResult> Confirm(BindingTokenInput input) => Authentication.Confirm(input.BindingToken, RequestId);
    [HttpPost("binding-requests")]
    public Task<object> RequestHelp(BindingTokenInput input) => Authentication.RequestHelp(input.BindingToken);
    [HttpPost("binding-status")]
    public Task<object> BindingStatus(BindingTokenInput input) => Authentication.BindingStatus(input.BindingToken);
    [HttpGet("binding-requests")]
    public async Task<object> Requests([FromQuery] PageQuery query) => await queries.BindingRequests(await Current(), query);
    [HttpPost("binding-requests/{id:long}/approve")]
    public async Task<object> Approve(long id, BindingDecisionInput input) => await Authentication.Decide(await Current(), id, input, true, RequestId);
    [HttpPost("binding-requests/{id:long}/reject")]
    public async Task<object> Reject(long id, BindingDecisionInput input) => await Authentication.Decide(await Current(), id, input, false, RequestId);
    [HttpPost("users/{id:long}/unbind")]
    public async Task<IActionResult> Unbind(long id, ReverseInput input) { await Authentication.Unbind(await Current(), id, input.Reason, RequestId); return NoContent(); }
    [HttpGet("me")]
    public async Task<object> Me() { var actor = await Current(); return new { actor.Id, actor.Name, actor.Roles, actor.SessionType, actor.SelectedRole }; }
    [HttpPost("select-role")]
    public async Task<IActionResult> SelectRole(RoleSelectionInput input)
    {
        await Authentication.SelectRole(await Current(), input.Role);
        return NoContent();
    }
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await Authentication.Logout(await Current());
        Response.Cookies.Delete("warehouse_session", new CookieOptions { Path = "/", Secure = settings.Production, SameSite = SameSiteMode.Strict });
        return NoContent();
    }
}
