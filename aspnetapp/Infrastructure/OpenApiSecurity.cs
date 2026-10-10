using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace aspnetapp.Infrastructure;

public sealed class OpenApiSecurity : IOperationFilter
{
    private static readonly string[] PublicAuthPaths = ["admin-login", "dev-login", "wechat-login", "bind-phone", "confirm-binding", "binding-status"];
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var path = context.ApiDescription.RelativePath ?? "";
        var publicAuth = path.StartsWith("api/auth/") && (PublicAuthPaths.Any(path.EndsWith) || (path.EndsWith("binding-requests") && context.ApiDescription.HttpMethod == "POST"));
        if (!path.StartsWith("api/") || publicAuth)
        {
            return;
        }
        // Cookie管理员和Bearer员工是两条独立会话路径；Cookie写请求额外需要X-CSRF-Token。
        operation.Security =
        [
            new() { [new OpenApiSecurityScheme { Reference = new() { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }] = [] },
            new() { [new OpenApiSecurityScheme { Reference = new() { Type = ReferenceType.SecurityScheme, Id = "AdminCookie" } }] = [] }
        ];
    }
}
