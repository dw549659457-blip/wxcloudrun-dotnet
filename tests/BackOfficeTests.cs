using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using aspnetapp.Services;
using ClosedXML.Excel;
using Xunit;
using static Business.Tests.TestFixture;

namespace Business.Tests;

public sealed class BackOfficeTests(TestFixture fixture) : IClassFixture<TestFixture>
{
    private const string Password = "Accountant-test-password-2026";
    private async Task<HttpClient> Browser(string role = Roles.Accountant)
    {
        if (role == Roles.Accountant) await Configure(BackOfficePermissions.Catalog.Where(entry => entry.DefaultGranted).Select(entry => entry.Key).ToArray());
        var username = "backoffice-" + Guid.NewGuid().ToString("N");
        var input = new UserInput(username, "后台测试账号", "139" + RandomNumberGenerator.GetInt32(10000000, 99999999), [role], Password: Password);
        (await Send(fixture.Clients["admin"], HttpMethod.Post, "/api/users", input)).EnsureSuccessStatusCode();
        var client = fixture.Factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, "/api/auth/admin-login", new LoginInput(username, Password));
        response.EnsureSuccessStatusCode();
        var login = await Json(response);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", login.GetProperty("csrfToken").GetString());
        Assert.Contains(role, login.GetProperty("roles").EnumerateArray().Select(entry => entry.GetString()));
        return client;
    }
    private async Task<JsonElement> Configure(string[] permissions)
    {
        var policy = await Json(await fixture.Clients["admin"].GetAsync("/api/backoffice-permissions"));
        var response = await Send(fixture.Clients["admin"], HttpMethod.Put, "/api/backoffice-permissions",
            new PermissionPolicyInput(policy.GetProperty("version").GetInt32(), permissions, "测试权限变更"));
        response.EnsureSuccessStatusCode();
        return await Json(response);
    }
    [Fact]
    public async Task Accountant_reads_other_users_documents_all_stock_and_batches_and_exports_real_excel()
    {
        var (packaging, _) = await fixture.Stock();
        var batch = await fixture.Dispatch(packaging);
        var dispatchId = (await Json(await fixture.Clients["driver1"].GetAsync("/api/dispatches"))).GetProperty("items")[0].GetProperty("id").GetInt64();
        using var browser = await Browser();
        foreach (var path in new[] { "/api/users", "/api/growers", "/api/inventory/packaging", "/api/inventory/vegetables", "/api/batches",
            $"/api/batches/{batch}/summary", "/api/dispatches", $"/api/dispatches/{dispatchId}", "/api/work-records", "/api/recoveries", "/api/outbounds", "/api/stock-documents", "/api/admin/reconcile" })
            (await browser.GetAsync(path)).EnsureSuccessStatusCode();
        foreach (var name in aspnetapp.Repositories.ReportRepository.Names)
        {
            (await browser.GetAsync("/api/reports/" + name)).EnsureSuccessStatusCode();
            (await browser.GetAsync("/api/reports/" + name + "/excel")).EnsureSuccessStatusCode();
        }
        foreach (var resource in new[] { "users", "growers", "packaging-types", "vegetable-types", "customers", "inventory-packaging", "inventory-vegetables", "batches", "dispatches", "stock-documents", "work-records", "recoveries", "outbounds" })
        {
            var response = await browser.GetAsync("/api/exports/" + resource);
            response.EnsureSuccessStatusCode();
            Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", response.Content.Headers.ContentType?.MediaType);
            using var workbook = new XLWorkbook(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
            Assert.NotNull(workbook.Worksheet("明细"));
            var text = string.Join('|', workbook.Worksheet("明细").CellsUsed().Select(cell => cell.GetString()));
            Assert.DoesNotContain(Password, text);
            Assert.DoesNotContain("pbkdf2", text, StringComparison.OrdinalIgnoreCase);
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await fixture.Clients["worker1"].GetAsync("/api/exports/dispatches")).StatusCode);
    }
    [Fact]
    public async Task Default_accountant_cannot_mutate_data_or_manage_security_even_by_direct_request()
    {
        var (packaging, _) = await fixture.Stock();
        var draft = await fixture.Create("admin", "stock-documents", new(new(2026, 10, 1), [new(packaging, 1)]), post: false);
        using var browser = await Browser();
        foreach (var request in new (HttpMethod Method, string Path, object? Input)[] {
            (HttpMethod.Post,"/api/growers",new ArchiveInput("拒绝新建")),
            (HttpMethod.Post,"/api/users",new UserInput("forbidden","越权","13912345678",[Roles.Admin],Password:Password)),
            (HttpMethod.Post,"/api/stock-documents",new DraftInput(new(new(2026,10,1),[new(packaging,1)]))),
            (HttpMethod.Put,$"/api/stock-documents/{draft}?version=1",new DocumentInput(new(2026,10,1),[new(packaging,2)])),
            (HttpMethod.Delete,$"/api/stock-documents/{draft}",null),
            (HttpMethod.Post,$"/api/stock-documents/{draft}/post",new PostInput(1)),
            (HttpMethod.Post,$"/api/admin/documents/stock-documents/{draft}/reverse",new ReverseInput("越权")),
            (HttpMethod.Post,$"/api/admin/documents/stock-documents/{draft}/correct",new CorrectInput("越权",new(new(2026,10,1),[new(packaging,3)]))),
            (HttpMethod.Put,"/api/backoffice-permissions",new PermissionPolicyInput(1,BackOfficePermissions.All,"越权")),
            (HttpMethod.Get,"/api/backoffice-permissions",null),
            (HttpMethod.Get,"/api/audit-logs",null),
            (HttpMethod.Get,"/api/backoffice-operation-logs",null),
            (HttpMethod.Get,"/api/backoffice-operation-logs/excel",null),
            (HttpMethod.Get,"/api/auth/binding-requests",null) })
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(browser,request.Method,request.Path,request.Input)).StatusCode);
        var document = await Json(await fixture.Clients["admin"].GetAsync($"/api/stock-documents/{draft}"));
        Assert.Equal("DRAFT", document.GetProperty("document").GetProperty("status").GetString());
    }
    [Fact]
    public async Task Permission_changes_take_effect_on_existing_cookie_and_cannot_escalate_accountant_to_admin()
    {
        using var browser = await Browser();
        var defaults = BackOfficePermissions.Catalog.Where(entry => entry.DefaultGranted).Select(entry => entry.Key).ToArray();
        await Configure([.. defaults, "archives.write"]);
        var result = await Send(browser, HttpMethod.Post, "/api/growers", new ArchiveInput("授权的新增")); result.EnsureSuccessStatusCode();
        await Configure(defaults.Where(key => key != "reports.export").ToArray());
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(browser, HttpMethod.Post, "/api/growers", new ArchiveInput("撤权后新增"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await browser.GetAsync("/api/reports/inventory-ledger/excel")).StatusCode);
        (await browser.GetAsync("/api/reports/inventory-ledger")).EnsureSuccessStatusCode();
        var identity = await Json(await browser.GetAsync("/api/auth/me"));
        Assert.DoesNotContain("reports.export", identity.GetProperty("permissions").EnumerateArray().Select(entry => entry.GetString()));
        await Configure(BackOfficePermissions.All);
        Assert.Equal(HttpStatusCode.Forbidden, (await browser.GetAsync("/api/backoffice-permissions")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(browser, HttpMethod.Post, "/api/users", new UserInput("escalation", "越权", "13912345678", [Roles.Admin], Password: Password))).StatusCode);
    }
    [Fact]
    public async Task Configuration_requires_valid_keys_dependencies_reason_and_current_version()
    {
        using var browser = await Browser();
        var current = await Json(await fixture.Clients["admin"].GetAsync("/api/backoffice-permissions"));
        var version = current.GetProperty("version").GetInt32();
        foreach (var input in new[] {
            new PermissionPolicyInput(version,["admin"],"无效键"),
            new PermissionPolicyInput(version,["documents.delete"],"缺少查询权限"),
            new PermissionPolicyInput(version,["users.read"]," ") })
            Assert.Equal(HttpStatusCode.BadRequest, (await Send(fixture.Clients["admin"],HttpMethod.Put,"/api/backoffice-permissions",input)).StatusCode);
        var changed = await Configure(["archives.read"]);
        Assert.Equal(HttpStatusCode.Conflict,(await Send(fixture.Clients["admin"],HttpMethod.Put,"/api/backoffice-permissions",new PermissionPolicyInput(version,["users.read"],"旧配置"))).StatusCode);
        Assert.True(changed.GetProperty("version").GetInt32()>version);
        (await fixture.Clients["admin"].GetAsync("/api/reports/inventory-ledger/excel")).EnsureSuccessStatusCode();
    }
    [Fact]
    public async Task Audits_capture_queries_exports_denials_modifications_deletions_and_safe_details()
    {
        using var browser = await Browser();
        using var adminBrowser = await Browser(Roles.Admin);
        var identity = await Json(await browser.GetAsync("/api/auth/me"));
        var actorId = identity.GetProperty("id").GetInt64();
        var read = await browser.GetAsync("/api/growers?search=审计查询&page=1&pageSize=20&token=must-not-record-secret"); read.EnsureSuccessStatusCode();
        var readId = read.Headers.GetValues("X-Request-Id").Single();
        var denied = await Send(browser,HttpMethod.Post,"/api/growers",new ArchiveInput("拒绝的修改"));
        Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        var export = await browser.GetAsync("/api/exports/growers"); export.EnsureSuccessStatusCode();
        var readLog = await Json(await adminBrowser.GetAsync($"/api/backoffice-operation-logs?actorId={actorId}&requestId={readId}"));
        var row = readLog.GetProperty("items").EnumerateArray().Single();
        Assert.Equal("READ",row.GetProperty("action").GetString());
        Assert.Equal(200,row.GetProperty("statusCode").GetInt32());
        Assert.Equal("COMPLETED",row.GetProperty("state").GetString());
        Assert.Equal("审计查询",JsonDocument.Parse(row.GetProperty("queryJson").GetString()!).RootElement.GetProperty("search").GetString());
        Assert.DoesNotContain("must-not-record-secret",row.GetProperty("queryJson").GetString());
        var failureLogs = await Json(await adminBrowser.GetAsync($"/api/backoffice-operation-logs?actorId={actorId}&statusCode=403&action=CREATE"));
        Assert.Contains(failureLogs.GetProperty("items").EnumerateArray(),entry=>entry.GetProperty("errorCode").GetString()=="FORBIDDEN");
        var exportLogs = await Json(await adminBrowser.GetAsync($"/api/backoffice-operation-logs?actorId={actorId}&action=EXPORT"));
        Assert.NotEmpty(exportLogs.GetProperty("items").EnumerateArray());
        var (packaging, _) = await fixture.Stock();
        var defaultKeys = BackOfficePermissions.Catalog.Where(entry=>entry.DefaultGranted).Select(entry=>entry.Key).ToArray();
        await Configure([..defaultKeys,"documents.create","documents.edit","documents.delete"]);
        var create = await Send(browser,HttpMethod.Post,"/api/stock-documents",new DraftInput(new(new(2026,10,1),[new(packaging,1)])));
        create.EnsureSuccessStatusCode();
        var id = (await Json(create)).GetProperty("id").GetInt64();
        var edit = await Send(browser,HttpMethod.Put,$"/api/stock-documents/{id}?version=1",new DocumentInput(new(2026,10,1),[new(packaging,2)])); edit.EnsureSuccessStatusCode();
        var editRequest = edit.Headers.GetValues("X-Request-Id").Single();
        var changes = await Json(await adminBrowser.GetAsync("/api/audit-logs?requestId="+editRequest));
        var change = changes.GetProperty("items").EnumerateArray().Single();
        Assert.Equal("EDIT_DRAFT",change.GetProperty("action").GetString());
        Assert.Equal("1",JsonDocument.Parse(change.GetProperty("beforeJson").GetString()!).RootElement.GetProperty("items")[0].GetProperty("quantity").GetString());
        Assert.Equal("2",JsonDocument.Parse(change.GetProperty("afterJson").GetString()!).RootElement.GetProperty("items")[0].GetProperty("quantity").GetString());
        var delete = await browser.DeleteAsync($"/api/stock-documents/{id}"); delete.EnsureSuccessStatusCode();
        var deleteId = delete.Headers.GetValues("X-Request-Id").Single();
        var deletion = await Json(await adminBrowser.GetAsync("/api/backoffice-operation-logs?requestId="+deleteId));
        Assert.Equal("DELETE",deletion.GetProperty("items")[0].GetProperty("action").GetString());
        Assert.Equal(204,deletion.GetProperty("items")[0].GetProperty("statusCode").GetInt32());
        var changeDelete = await Json(await adminBrowser.GetAsync("/api/audit-logs?requestId="+deleteId));
        Assert.Equal("DELETE_DRAFT",changeDelete.GetProperty("items")[0].GetProperty("action").GetString());
        var download = await adminBrowser.GetAsync($"/api/backoffice-operation-logs/excel?actorId={actorId}"); download.EnsureSuccessStatusCode();
        using var workbook = new XLWorkbook(new MemoryStream(await download.Content.ReadAsByteArrayAsync()));
        var cells = string.Join('|',workbook.Worksheet("明细").CellsUsed().Select(cell=>cell.GetString()));
        Assert.DoesNotContain(Password,cells);
        Assert.DoesNotContain("warehouse_session",cells);
    }
    [Fact]
    public async Task Granted_post_correction_and_reversal_preserve_stock_transactions_and_revoked_post_blocks_cached_retry()
    {
        using var browser = await Browser();
        var (packaging, _) = await fixture.Stock();
        await Configure(BackOfficePermissions.All);
        var key = Guid.NewGuid().ToString("N");
        var input = new DraftInput(new(new(2026, 10, 1), [new(packaging, 5)]));
        var draft = await Json(await Send(browser, HttpMethod.Post, "/api/stock-documents", input));
        var id = draft.GetProperty("id").GetInt64();
        (await Send(browser, HttpMethod.Post, $"/api/stock-documents/{id}/post", new PostInput(1), key)).EnsureSuccessStatusCode();
        Assert.Equal(1005, await fixture.Balance(packaging));
        var corrected = await Send(browser, HttpMethod.Post, $"/api/admin/documents/stock-documents/{id}/correct",
            new CorrectInput("获授权会计更正", new(new(2026, 10, 1), [new(packaging, 6)])));
        corrected.EnsureSuccessStatusCode();
        var replacement = (await Json(corrected)).GetProperty("id").GetInt64();
        Assert.Equal(1006, await fixture.Balance(packaging));
        (await Send(browser, HttpMethod.Post, $"/api/admin/documents/stock-documents/{replacement}/reverse", new ReverseInput("获授权会计冲销"))).EnsureSuccessStatusCode();
        Assert.Equal(1000, await fixture.Balance(packaging));
        await Configure(BackOfficePermissions.All.Where(permission => permission != "documents.post").ToArray());
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(browser, HttpMethod.Post, $"/api/stock-documents/{id}/post", new PostInput(1), key)).StatusCode);
        Assert.Equal(1000, await fixture.Balance(packaging));
        var reconcile = await Json(await fixture.Clients["admin"].GetAsync("/api/admin/reconcile"));
        Assert.True(reconcile.GetProperty("consistent").GetBoolean());
    }
    [Fact]
    public async Task Csrf_denials_are_logged_without_executing_the_change()
    {
        using var browser = await Browser();
        browser.DefaultRequestHeaders.Remove("X-CSRF-Token");
        var response = await Send(browser,HttpMethod.Post,"/api/growers",new ArchiveInput("CSRF拒绝"));
        Assert.Equal(HttpStatusCode.Forbidden,response.StatusCode);
        var requestId=response.Headers.GetValues("X-Request-Id").Single();
        var logs = await Json(await fixture.Clients["admin"].GetAsync("/api/backoffice-operation-logs?requestId="+requestId));
        Assert.Equal("CSRF_REJECTED",logs.GetProperty("items")[0].GetProperty("errorCode").GetString());
    }
}
