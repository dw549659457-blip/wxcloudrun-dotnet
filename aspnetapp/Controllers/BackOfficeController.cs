using aspnetapp.Domain;
using aspnetapp.Repositories;
using aspnetapp.Services;
using Microsoft.AspNetCore.Mvc;

namespace aspnetapp.Controllers;

[ApiController]
[Route("api")]
public sealed class BackOfficeController(AuthService authentication, PermissionService permissions,
    OperationAuditService audit, QueryRepository queries, ExcelService excel) : ApiController(authentication)
{
    [HttpGet("backoffice-permissions")]
    public async Task<object> Permissions() => await permissions.Read(await Current());
    [HttpPut("backoffice-permissions")]
    public async Task<object> SavePermissions(PermissionPolicyInput input) => await permissions.Save(await Current(), input, RequestId);
    [HttpGet("backoffice-operation-logs")]
    public async Task<object> Operations([FromQuery] PageQuery query)
    {
        var rows = await audit.Rows(await Current(), query);
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
    [HttpGet("backoffice-operation-logs/excel")]
    public async Task<IActionResult> ExportOperations([FromQuery] PageQuery query)
        => File(excel.Export("后台操作记录", await audit.Rows(await Current(), query, true), query),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "backoffice-operations.xlsx");
    [HttpGet("exports/{resource}")]
    public async Task<IActionResult> Export(string resource, [FromQuery] PageQuery query)
        => File(excel.Export(resource, await queries.DataExport(await Current(), resource, query), query),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resource + ".xlsx");
}
