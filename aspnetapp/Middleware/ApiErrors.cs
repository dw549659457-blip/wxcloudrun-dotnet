using aspnetapp.Domain;
using MySqlConnector;

namespace aspnetapp.Middleware;

public sealed class ApiErrors(RequestDelegate next, ILogger<ApiErrors> logger)
{
    public async Task Invoke(HttpContext context)
    {
        context.TraceIdentifier = Guid.NewGuid().ToString("N");
        context.Response.Headers["X-Request-Id"] = context.TraceIdentifier;
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers.CacheControl = "no-store";
        var start = System.Diagnostics.Stopwatch.StartNew();
        try { await next(context); }
        catch (Exception error)
        {
            if (context.Response.HasStarted)
            {
                throw;
            }

            var business = error as BusinessException;
            var duplicate = error is MySqlException { Number: 1062 };
            var unavailable = error is MySqlException { Number: 1042 or 1045 or 2002 or 2006 };
            var invalid = error is BadHttpRequestException or System.Text.Json.JsonException;
            context.Response.StatusCode = business?.Status ?? (duplicate ? 409 : unavailable ? 503 : invalid ? 400 : 500);
            // 不输出异常全文/SQL/连接字符串/微信请求 URI，防止凭据进入日志。
            if (business is null && !duplicate && !invalid)
            {
                logger.LogError("Request {RequestId} failed with {ErrorType}", context.TraceIdentifier, error.GetType().Name);
            }

            await context.Response.WriteAsJsonAsync(new { code = business?.Code ?? (duplicate ? "DUPLICATE_RECORD" : unavailable ? "DATABASE_UNAVAILABLE" : invalid ? "VALIDATION_FAILED" : "INTERNAL_ERROR"), message = business?.Message ?? (duplicate ? "记录已存在，请刷新检查" : invalid ? "请求格式不正确" : "服务暂时未完成请求，请用原提交标识确认结果"), details = business?.Details, requestId = context.TraceIdentifier });
        }
        finally { logger.LogInformation("Request {RequestId} {Method} {Path} returned {Status} in {ElapsedMs}ms", context.TraceIdentifier, context.Request.Method, context.Request.Path.Value, context.Response.StatusCode, start.ElapsedMilliseconds); }
    }
}
