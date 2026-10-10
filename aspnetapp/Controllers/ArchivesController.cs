using Microsoft.AspNetCore.Mvc;
using aspnetapp.Domain;
using aspnetapp.Services;
using aspnetapp.Repositories;

namespace aspnetapp.Controllers;

[ApiController]
[Route("api/growers")]
[Route("api/packaging-types")]
[Route("api/vegetable-types")]
[Route("api/customers")]
public sealed class ArchivesController(AuthService authentication, ArchiveService service, QueryRepository queries) : ApiController(authentication)
{
    private string ArchiveKind => ArchiveService.Kind(Request.Path.Value!.Split('/')[2]);
    [HttpGet]
    public async Task<object> List([FromQuery] PageQuery query) => await queries.Archives(await Current(), ArchiveKind, query);
    [HttpPost]
    public async Task<object> Create(ArchiveInput input) => await service.Save(await Current(), ArchiveKind, null, input, RequestId);
    [HttpPut("{id:long}")]
    public async Task<object> Update(long id, ArchiveInput input) => await service.Save(await Current(), ArchiveKind, id, input, RequestId);
}

[ApiController]
[Route("api/users")]
public sealed class UsersController(AuthService authentication, ArchiveService service, QueryRepository queries) : ApiController(authentication)
{
    [HttpGet]
    public async Task<object> List([FromQuery] PageQuery query) => await queries.Users(await Current(), query);
    [HttpPost]
    public async Task<object> Create(UserInput input) => await service.SaveUser(await Current(), null, input, RequestId);
    [HttpPut("{id:long}")]
    public async Task<object> Update(long id, UserInput input) => await service.SaveUser(await Current(), id, input, RequestId);
}
