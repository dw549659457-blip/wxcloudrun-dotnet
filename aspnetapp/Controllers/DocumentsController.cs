using Microsoft.AspNetCore.Mvc;
using aspnetapp.Domain;
using aspnetapp.Services;
using aspnetapp.Repositories;

namespace aspnetapp.Controllers;

[ApiController]
[Route("api/dispatches")]
[Route("api/work-records")]
[Route("api/recoveries")]
[Route("api/outbounds")]
[Route("api/stock-documents")]
public sealed class DocumentsController(AuthService authentication, DocumentService service, QueryRepository queries) : ApiController(authentication)
{
    public static string Kind(string resource) => resource switch { "dispatches" => DocumentKinds.Dispatch, "work-records" => DocumentKinds.Work, "recoveries" => DocumentKinds.Recovery, "outbounds" => DocumentKinds.Outbound, "stock-documents" => DocumentKinds.Stock, _ => throw new BusinessException(404, "NOT_FOUND", "未知单据类型") };
    private string DocumentKind => Kind(Request.Path.Value!.Split('/')[2]);
    [HttpGet]
    public async Task<DocumentPage> List([FromQuery] PageQuery query) => await queries.Documents(await Current(), DocumentKind, query);
    [HttpGet("{id:long}")]
    public async Task<object> Detail(long id) => await queries.Document(await Current(), DocumentKind, id);
    [HttpPost]
    public async Task<SubmissionResult> Create(DraftInput input) => await service.Create(await Current(), DocumentKind, input, Key, RequestId);
    [HttpPost("{id:long}/post")]
    public async Task<SubmissionResult> Post(long id, PostInput input) => await service.Post(await Current(), id, DocumentKind, input.Version, Key, RequestId);
    [HttpPut("{id:long}")]
    public async Task<SubmissionResult> Edit(long id, [FromQuery] int version, DocumentInput input) => await service.Edit(await Current(), id, DocumentKind, version, input);
    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id) { await service.Delete(await Current(), id, DocumentKind); return NoContent(); }
}
