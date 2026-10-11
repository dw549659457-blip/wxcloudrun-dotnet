using aspnetapp.Domain;
using aspnetapp.Services;
using Microsoft.AspNetCore.Mvc.Controllers;

namespace aspnetapp.Middleware;

public sealed class BackOfficeAudit(RequestDelegate next, ILogger<BackOfficeAudit> logger)
{
    private static readonly string[] PublicActions = ["AdminLogin", "DevelopmentLogin", "WechatLogin", "BindPhone", "Confirm", "BindingStatus", "RequestHelp"];
    public async Task Invoke(HttpContext context, AuthService auth, OperationAuditService audit)
    {
        var endpoint = context.GetEndpoint()?.Metadata.GetMetadata<ControllerActionDescriptor>();
        if (endpoint is null) { await next(context); return; }
        var clock = System.Diagnostics.Stopwatch.StartNew();
        Exception? failure = null;
        try
        {
            if (endpoint.ControllerName != "Auth" || !PublicActions.Contains(endpoint.ActionName))
            {
                var actor = await auth.Authenticate(context);
                if (actor.SessionType == SessionTypes.WebAdmin || actor.IsAdmin)
                    context.Items["OperationLogId"] = await audit.Start(context, actor);
            }
            await next(context);
        }
        catch (Exception error) { failure = error; throw; }
        finally
        {
            try
            {
                // CSRF/权限拒绝也留记录；已认证的后台身份来自服务器会话。
                if (context.Items["OperationLogId"] is not long && context.Items["AuditActor"] is Actor denied && (denied.SessionType == SessionTypes.WebAdmin || denied.IsAdmin))
                    context.Items["OperationLogId"] = await audit.Start(context, denied);
                if (context.Items["OperationLogId"] is long id)
                    await audit.Complete(id, failure is null ? context.Response.StatusCode : ApiErrors.Status(failure),
                        (failure as BusinessException)?.Code, clock.ElapsedMilliseconds);
            }
            catch (Exception error)
            {
                // 开始记录已落库时保留 STARTED，不把未知结果假报成完成；业务事务另有明细审计。
                logger.LogError("Operation audit completion failed for {RequestId} with {Type}", context.TraceIdentifier, error.GetType().Name);
            }
        }
    }
}
