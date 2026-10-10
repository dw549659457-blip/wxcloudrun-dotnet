using Microsoft.AspNetCore.Mvc;
using aspnetapp.Domain;
using aspnetapp.Services;
using aspnetapp.Repositories;

namespace aspnetapp.Controllers;

[ApiController]
[Route("api")]
public sealed class InventoryController(AuthService authentication, QueryRepository queries, ReportRepository reports, DocumentService documents, ExcelService excel) : ApiController(authentication)
{
    [HttpGet("roles")]
    public async Task<object> RolesList() { (await Current()).Require(Roles.Admin); return Roles.All; }
    [HttpGet("batches")]
    public async Task<object> Batches([FromQuery] PageQuery query) => await queries.Batches(await Current(), null, query);
    [HttpGet("batches/{id:long}/summary")]
    public async Task<object> Batch(long id) => await queries.Batches(await Current(), id, new());
    [HttpGet("inventory/vegetables")]
    public async Task<object> Vegetables([FromQuery] PageQuery query) => await queries.Inventory(await Current(), false, query);
    [HttpGet("inventory/packaging")]
    public async Task<object> Packaging([FromQuery] PageQuery query) => await queries.Inventory(await Current(), true, query);
    [HttpGet("submissions/status")]
    public async Task<object> Submission([FromQuery] string operation, [FromQuery] string key) => await queries.Submission(await Current(), operation, key);
    [HttpGet("audit-logs")]
    public async Task<object> Audits([FromQuery] PageQuery query) => await queries.Audits(await Current(), query);
    [HttpGet("reports/{name}")]
    public async Task<object> Report(string name, [FromQuery] PageQuery query)
    {
        var rows = await reports.Rows(await Current(), name, query);
        return new { items = rows.Select(row => row.Output()), query.Page, query.PageSize };
    }
    [HttpGet("reports/{name}/excel")]
    public async Task<IActionResult> Export(string name, [FromQuery] PageQuery query)
    {
        var rows = await reports.Rows(await Current(), name, query, true);
        Response.Headers.CacheControl = "no-store";
        return File(excel.Export(name, rows, query), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{name}-{DateTime.UtcNow:yyyyMMdd}.xlsx");
    }
    [HttpGet("admin/reconcile")]
    public async Task<object> Reconcile() { (await Current()).Require(Roles.Admin); var errors = await reports.Reconcile(); return new { consistent = errors.Count == 0, errors }; }
    [HttpPost("admin/documents/{type}/{id:long}/reverse")]
    public async Task<SubmissionResult> Reverse(string type, long id, ReverseInput input) => await documents.Reverse(await Current(), DocumentsController.Kind(type), id, input.Reason, Key, RequestId);
    [HttpPost("admin/documents/{type}/{id:long}/correct")]
    public async Task<SubmissionResult> Correct(string type, long id, CorrectInput input) => await documents.Correct(await Current(), DocumentsController.Kind(type), id, input, Key, RequestId);
}
