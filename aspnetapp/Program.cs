using aspnetapp.Configuration;
using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using aspnetapp.Integrations;
using aspnetapp.Middleware;
using aspnetapp.Repositories;
using aspnetapp.Services;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using System.Net;

try
{
    var settings = AppSettings.Load();
    var builder = WebApplication.CreateBuilder(args);
    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Limits.MaxRequestBodySize = 256 * 1024;
        options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(15);
    });
    builder.Services.AddSingleton(settings);
    builder.Services.AddSingleton<Database>();
    builder.Services.AddSingleton<TransactionService>();
    builder.Services.AddSingleton<DocumentRepository>();
    builder.Services.AddSingleton<InventoryRepository>();
    builder.Services.AddSingleton<QueryRepository>();
    builder.Services.AddSingleton<ReportRepository>();
    builder.Services.AddSingleton<DocumentService>();
    builder.Services.AddSingleton<AuthService>();
    builder.Services.AddSingleton<ArchiveService>();
    builder.Services.AddSingleton<ExcelService>();
    builder.Services.AddSingleton<MigrationRunner>();
    builder.Services.AddSingleton<Initialization>();
    builder.Services.AddSingleton<IWechatGateway, WechatGateway>();
    builder.Services.AddHttpClient("wechat", client => client.Timeout = TimeSpan.FromSeconds(10));
    // HttpClient 默认日志包含带 secret/access_token 的 URL，必须关闭该类别。
    builder.Logging.AddFilter("System.Net.Http.HttpClient.wechat", LogLevel.None);
    builder.Services.AddControllers().AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow;
        options.JsonSerializerOptions.Converters.Add(new DecimalStringConverter());
    });
    builder.Services.ConfigureHttpJsonOptions(options =>
    {
        // 错误details及健康/最小API响应也遵守数量字符串约定，不能遗漏另一套JSON配置。
        options.SerializerOptions.Converters.Add(new DecimalStringConverter());
    });
    builder.Services.Configure<ApiBehaviorOptions>(options => options.InvalidModelStateResponseFactory = context => new BadRequestObjectResult(new { code = "VALIDATION_FAILED", message = "请检查必填字段、日期和数量格式", details = context.ModelState.Where(entry => entry.Value?.Errors.Count > 0).Select(entry => entry.Key), requestId = context.HttpContext.TraceIdentifier }));
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen(options =>
    {
        options.SwaggerDoc("v1", new() { Title = "包装流转与蔬菜库存后台", Version = "v1" });
        options.AddSecurityDefinition("Bearer", new() { Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http, Scheme = "bearer", Description = "员工会话令牌；后台使用 HttpOnly Cookie + X-CSRF-Token" });
        options.AddSecurityDefinition("AdminCookie", new() { Type = Microsoft.OpenApi.Models.SecuritySchemeType.ApiKey, In = Microsoft.OpenApi.Models.ParameterLocation.Cookie, Name = "warehouse_session", Description = "后台登录设置的HttpOnly Cookie；写请求加X-CSRF-Token" });
        options.OperationFilter<OpenApiSecurity>();
        options.MapType<decimal>(() => new() { Type = "string", Example = new Microsoft.OpenApi.Any.OpenApiString("12.500") });
    });
    builder.Services.AddRequestTimeouts(options => options.AddPolicy("default", new Microsoft.AspNetCore.Http.Timeouts.RequestTimeoutPolicy()
    {
        Timeout = TimeSpan.FromSeconds(settings.RequestTimeoutSeconds),
        TimeoutStatusCode = 504,
        WriteTimeoutResponse = context => context.Response.WriteAsJsonAsync(new
        {
            code = "SUBMISSION_NOT_CONFIRMED",
            message = "暂时没有确认结果，请使用原提交标识查询或重试",
            details = (object?)null,
            requestId = context.TraceIdentifier
        })
    }));
    var app = builder.Build();
    var command = Environment.GetEnvironmentVariable("APP_COMMAND");
    if (command is not null)
    {
        switch (command)
        {
            case "inspect-db": await app.Services.GetRequiredService<Initialization>().InspectDatabase(); break;
            case "create-database": await app.Services.GetRequiredService<Initialization>().CreateDatabase(); break;
            case "migrate": await app.Services.GetRequiredService<MigrationRunner>().Run(); break;
            case "seed": await app.Services.GetRequiredService<Initialization>().Seed(); break;
            case "init-admin": await app.Services.GetRequiredService<Initialization>().Admin(); break;
            case "reconcile":
                var errors = await app.Services.GetRequiredService<ReportRepository>().Reconcile();
                Console.WriteLine(JsonSettings.Serialize(new { consistent = errors.Count == 0, errors }));
                Environment.ExitCode = errors.Count == 0 ? 0 : 1; break;
            default: throw new InvalidOperationException("未知 APP_COMMAND");
        }
        return;
    }
    app.UseMiddleware<ApiErrors>();
    if (settings.TrustedProxies.Length > 0)
    {
        var forwarding = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto, ForwardLimit = 1 };
        forwarding.KnownProxies.Clear(); forwarding.KnownIPNetworks.Clear();
        foreach (var proxy in settings.TrustedProxies)
        {
            forwarding.KnownProxies.Add(IPAddress.Parse(proxy));
        }

        app.UseForwardedHeaders(forwarding);
    }
    app.UseRouting();
    app.UseRequestTimeouts();
    app.MapControllers().WithRequestTimeout("default");
    app.MapGet("/health/live", () => Results.Ok(new { status = "alive" }));
    app.MapGet("/health/ready", async (Database database) =>
    {
        try { await using var connection = await database.Open(); await Database.Query(connection, null, "SELECT 1"); return Results.Ok(new { status = "ready" }); }
        catch (MySqlConnector.MySqlException) { return Results.Json(new { status = "not_ready" }, statusCode: 503); }
    });
    app.MapGet("/", () => Results.Ok(new { service = "包装流转与蔬菜库存后台", login = "/api/auth/admin-login" }));
    app.MapGet("/health", () => Results.Ok(new { status = "alive", readiness = "/health/ready" }));
    if (!settings.Production) { app.UseSwagger(); app.UseSwaggerUI(); }
    app.MapFallback((HttpContext context) => Results.Json(new { code = "NOT_FOUND", message = "未找到接口", details = (object?)null, requestId = context.TraceIdentifier }, statusCode: 404));
    // 云托管 HTTPS 由入口终止，应用监听 HTTP 0.0.0.0；不在启动时自动迁移。
    app.Urls.Add($"http://0.0.0.0:{settings.Port}");
    await app.RunAsync();
}
catch (Exception error) when (error is not HostAbortedException)
{
    StartupDiagnostics.Report(error);
    Environment.ExitCode = 1;
}
public partial class Program;
